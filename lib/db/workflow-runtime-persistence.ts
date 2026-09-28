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
}> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  try {
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("database") || !keys.includes("domainWorkspaceId")) {
      return false;
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
      stateStore: new PostgresWorkflowRuntimeStateStore({ database: input.database, tenant }),
      readModel: new PostgresWorkflowRuntimeReadModel({ database: input.database, tenant }),
    });
  } catch {
    return null;
  }
}
