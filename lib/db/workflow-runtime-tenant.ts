// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";

export interface WorkflowRuntimeTenantSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<Readonly<{ rows: readonly Row[]; rowCount: number }>>;
  release(): void;
}

export interface WorkflowRuntimeTenantDatabase {
  connect(): Promise<WorkflowRuntimeTenantSqlClient>;
}

export type ResolvedWorkflowRuntimeTenant = Readonly<{
  workspaceId: string;
  workspaceDatabaseId: string;
}>;

export interface WorkflowRuntimeTenantResolver {
  resolve(domainWorkspaceId: unknown): Promise<ResolvedWorkflowRuntimeTenant | null>;
}

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const resolvedTenantIdentities = new WeakSet<object>();

function database(input: unknown): WorkflowRuntimeTenantDatabase | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  try {
    return typeof (input as { connect?: unknown }).connect === "function"
      ? input as WorkflowRuntimeTenantDatabase
      : null;
  } catch {
    return null;
  }
}

export function isResolvedWorkflowRuntimeTenant(
  input: unknown,
): input is ResolvedWorkflowRuntimeTenant {
  return typeof input === "object" && input !== null && resolvedTenantIdentities.has(input);
}

export function createPostgresWorkflowRuntimeTenantResolver(
  databaseInput: unknown,
): WorkflowRuntimeTenantResolver {
  const trustedDatabase = database(databaseInput);
  if (!trustedDatabase) throw new Error("Workflow runtime tenant resolver configuration is invalid.");
  const resolvedDatabase = trustedDatabase;

  async function resolve(domainWorkspaceId: unknown): Promise<ResolvedWorkflowRuntimeTenant | null> {
    if (typeof domainWorkspaceId !== "string" || !stableIdPattern.test(domainWorkspaceId)) {
      return null;
    }
    let client: WorkflowRuntimeTenantSqlClient | null = null;
    try {
      client = await resolvedDatabase.connect();
      const result = await client.query<{
        workspace_database_id: unknown;
        domain_workspace_id: unknown;
        status: unknown;
      }>(
        `/* workflow-runtime-tenant:resolve */
         select id::text as workspace_database_id, domain_workspace_id, status
         from workspaces
         where domain_workspace_id = $1
         limit 2`,
        [domainWorkspaceId],
      );
      if (result.rowCount !== 1 || result.rows.length !== 1) return null;
      const row = result.rows[0];
      if (row.domain_workspace_id !== domainWorkspaceId
        || typeof row.workspace_database_id !== "string"
        || !uuidPattern.test(row.workspace_database_id)
        || (row.status !== "demo" && row.status !== "active")) return null;
      const tenant = freezeModelProviderAdapterData({
        workspaceId: domainWorkspaceId,
        workspaceDatabaseId: row.workspace_database_id.toLowerCase(),
      });
      resolvedTenantIdentities.add(tenant);
      return tenant;
    } catch {
      return null;
    } finally {
      client?.release();
    }
  }

  return Object.freeze({ resolve });
}
