import type { ProviderClaimLeaseTiming } from "../contracts/provider-claim-lease-policy";
import type { WorkflowRuntimeDatabase } from "./workflow-runtime-store";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { PostgresWorkflowRuntimeReadModel } from "./workflow-runtime-read-model.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { PostgresWorkflowRuntimeStateStore } from "./workflow-runtime-store.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver } from "./workflow-runtime-tenant.ts";

export type PostgresWorkflowRuntimePersistence = Readonly<{
  stateStore: PostgresWorkflowRuntimeStateStore;
  readModel: PostgresWorkflowRuntimeReadModel;
}>;

function inputFields(input: unknown): input is Readonly<{
  database: WorkflowRuntimeDatabase;
  domainWorkspaceId: string;
  providerExecutionTiming?: unknown;
}> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    const keys = Reflect.ownKeys(input);
    // AI-037.6a: the only optional key is the trusted provider timing; the store verifies it.
    const withTiming = keys.length === 3 && keys.includes("providerExecutionTiming");
    if ((keys.length !== 2 && !withTiming) || !keys.includes("database") || !keys.includes("domainWorkspaceId")) {
      return false;
    }
    if (withTiming) {
      const timing = Object.getOwnPropertyDescriptor(input, "providerExecutionTiming");
      if (!timing || !Object.hasOwn(timing, "value")) return false;
    }
    const database = Object.getOwnPropertyDescriptor(input, "database");
    const workspace = Object.getOwnPropertyDescriptor(input, "domainWorkspaceId");
    return Boolean(database && workspace
      && Object.hasOwn(database, "value") && Object.hasOwn(workspace, "value")
      && typeof database.value === "object" && database.value !== null
      && typeof workspace.value === "string");
  } catch {
    return false;
  }
}

export async function createPostgresWorkflowRuntimePersistence(
  input: unknown,
): Promise<PostgresWorkflowRuntimePersistence | null> {
  if (!inputFields(input)) return null;
  try {
    const tenant = await createPostgresWorkflowRuntimeTenantResolver(input.database)
      .resolve(input.domainWorkspaceId);
    if (!tenant) return null;
    return Object.freeze({
      stateStore: new PostgresWorkflowRuntimeStateStore({
        database: input.database,
        tenant,
        // The store accepts only a trusted timing object and throws otherwise (→ null below).
        ...(input.providerExecutionTiming === undefined
          ? {}
          : { providerExecutionTiming: input.providerExecutionTiming as ProviderClaimLeaseTiming }),
      }),
      readModel: new PostgresWorkflowRuntimeReadModel({ database: input.database, tenant }),
    });
  } catch {
    return null;
  }
}
