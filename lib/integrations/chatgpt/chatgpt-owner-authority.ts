import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../../db/workflow-runtime-tenant";
import type { AuthenticatedIdentitySource } from "../../composition/authenticated-owner-read-runtime";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { capturedMethod, inTransaction, lockOwnerAuthority, resolveUserId } from "../../tasks/owner-task-mutations.ts";

// AI-039.2: PAC Owner authority for the ChatGPT plan integration. PAC identity stays GitHub / Auth.js;
// the ChatGPT account is only an integration credential and never authorizes anything in PAC.
//
// * resolveSessionOwner: the authenticated PAC user of THIS request (verified session identity source)
//   holding the Owner role in the trusted workspace (the same Owner predicate as every audited write,
//   re-checked with FOR SHARE in one short read transaction).
// * verifyOwner: the same predicate for a user bound to a pending OAuth attempt (callback re-check).
// The workspace is trusted server configuration; the browser never supplies workspace, user or role.

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

async function tenantFor(database: WorkflowRuntimeDatabase, domainWorkspaceId: string): Promise<ResolvedWorkflowRuntimeTenant | null> {
  if (!stableIdPattern.test(domainWorkspaceId)) return null;
  try {
    const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domainWorkspaceId);
    return tenant && isResolvedWorkflowRuntimeTenant(tenant) ? tenant : null;
  } catch {
    return null;
  }
}

export async function verifyOwner(database: WorkflowRuntimeDatabase, input: Readonly<{ ownerUserId: string; domainWorkspaceId: string }>): Promise<boolean> {
  if (typeof window !== "undefined" || !uuidPattern.test(input.ownerUserId)) return false;
  const tenant = await tenantFor(database, input.domainWorkspaceId);
  if (!tenant) return false;
  try {
    await inTransaction(database, async (client: WorkflowRuntimeSqlClient) => {
      await lockOwnerAuthority(client, tenant, input.ownerUserId);
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveSessionOwner(database: WorkflowRuntimeDatabase, domainWorkspaceId: string, identitySource: AuthenticatedIdentitySource):
Promise<Readonly<{ status: "owner"; ownerUserId: string; domainWorkspaceId: string }> | Readonly<{ status: "unauthenticated" | "denied" }>> {
  const resolve = capturedMethod(identitySource, "resolve");
  if (!resolve) return { status: "denied" };
  const userId = await resolveUserId(resolve);
  if (!userId) return { status: "unauthenticated" };
  return (await verifyOwner(database, { ownerUserId: userId, domainWorkspaceId }))
    ? Object.freeze({ status: "owner" as const, ownerUserId: userId, domainWorkspaceId })
    : { status: "denied" };
}
