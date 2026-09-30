import { isProxy } from "node:util/types";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { OwnerReadBackend } from "./owner-read-runtime";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createOwnerReadRuntimeForTenant } from "./owner-read-runtime.ts";

// AI-038.1 authenticated identity boundary (provider-neutral, request-scoped, server-only).
//
//   trusted server config { database, domainWorkspaceId }
//     → tenant resolved FIRST (existing trusted resolver)
//     → request-scoped AuthenticatedIdentitySource.resolve() — ONCE, no arguments
//     → { userId } validated as untrusted data (internal PAC user UUID only)
//     → ONE tenant-scoped SQL check: active user, active membership in THIS workspace, still
//       demo/active workspace, and an assigned `owner` role that is this workspace's own role or an
//       explicit global system role (the only global case the 0007 schema permits)
//     → actorId := the internal user id → AI-038.0 OwnerReadBackend → AI-037.7 facade
//
// The caller never supplies userId, actorId, workspace, role or permission. Nothing is cached: each
// composition re-reads identity and membership, so revocation applies to the next request. This
// module implements NO authentication; a concrete session adapter (AI-038.2) will implement the
// identity source. Application code must import `./authenticated-owner-read-runtime.server`.

// The contract a future session adapter implements. `resolve` takes no arguments and yields the
// authenticated internal user, or null when there is no authenticated session. It must not return
// tokens, cookies or provider claims; anything beyond `{ userId }` is rejected.
export interface AuthenticatedIdentitySource {
  resolve(): Promise<Readonly<{ userId: string }> | null> | Readonly<{ userId: string }> | null;
}

export type AuthenticatedOwnerReadDecision =
  | Readonly<{ verdict: "allow"; reason: null; backend: OwnerReadBackend }>
  | Readonly<{ verdict: "deny"; reason: "unauthenticated" | "unavailable"; backend: null }>;

type VerifiedOwnerPrincipal = Readonly<{ userId: string; actorId: string }>;

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const configurationFields = Object.freeze(["database", "domainWorkspaceId", "identitySource"] as const);

function deny(reason: "unauthenticated" | "unavailable"): AuthenticatedOwnerReadDecision {
  return freezeModelProviderAdapterData({ verdict: "deny" as const, reason, backend: null });
}

function plainNonProxy(input: unknown): input is object {
  if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

// Own data members of an ordinary non-Proxy object with exactly `fields`; getters never run.
function exactOwnData(input: unknown, fields: readonly string[]): Record<string, unknown> | null {
  try {
    if (!plainNonProxy(input)) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) return null;
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      values[field] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

// Captures one own data method as a callable value; it is later invoked with no receiver, so the
// caller's object (and anything reachable through its `this`) is never retained as authority.
function capturedMethod(input: unknown, name: string): ((...args: unknown[]) => unknown) | null {
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function"
      ? descriptor.value as (...args: unknown[]) => unknown
      : null;
  } catch {
    return null;
  }
}

// The identity source's answer is untrusted data: exactly `{ userId: <canonical UUID> }` from an
// ordinary non-Proxy object with an own data property. null/undefined means "no session".
function authenticatedUserId(output: unknown): string | null {
  const fields = exactOwnData(output, ["userId"]);
  if (!fields) return null;
  const userId = fields.userId;
  return typeof userId === "string" && userId.length === 36 && uuidPattern.test(userId.toLowerCase())
    ? userId.toLowerCase()
    : null;
}

// Never `await` an arbitrary value: awaiting performs a `then` lookup, which would run a Proxy trap or
// a getter. A synchronous result is validated directly; only a genuine native Promise (exactly
// Promise.prototype, no own `then`/`constructor`) is awaited; any other thenable or Proxy is rejected
// without touching it. (If a source's OWN async code resolves to a Proxy, the Promise machinery may
// consult it inside the source; the resolved value is still rejected here by isProxy.)
// This classifier is deliberately synchronous and returns a wrapper: returning a thenable from an
// async function (or awaiting it) would itself invoke its `then`.
type IdentityOutput =
  | Readonly<{ kind: "value"; value: unknown }>
  | Readonly<{ kind: "promise"; promise: Promise<unknown> }>
  | Readonly<{ kind: "rejected" }>;
function classifyIdentityOutput(raw: unknown): IdentityOutput {
  try {
    if (typeof raw !== "object" || raw === null) return { kind: "value", value: raw };
    if (isProxy(raw)) return { kind: "rejected" };
    if (Object.getPrototypeOf(raw) === Promise.prototype) {
      return Object.hasOwn(raw, "then") || Object.hasOwn(raw, "constructor")
        ? { kind: "rejected" }
        : { kind: "promise", promise: raw as Promise<unknown> };
    }
    return { kind: "value", value: raw };
  } catch {
    return { kind: "rejected" };
  }
}

// One statement, one snapshot, filtered entirely in SQL by the bound workspace: no authorization
// fact is read across workspaces and filtered in memory.
async function verifyOwnerPrincipal(
  database: WorkflowRuntimeDatabase,
  tenant: ResolvedWorkflowRuntimeTenant,
  userId: string,
): Promise<VerifiedOwnerPrincipal | null> {
  let client: WorkflowRuntimeSqlClient | null = null;
  let failed = false;
  try {
    client = await database.connect();
    const result = await client.query<{ is_owner: unknown }>(
      `/* owner-principal:verify */
       select exists (
         select 1
         from users as account
         join workspace_members as member
           on member.user_id = account.id and member.workspace_id = $1::uuid
         join workspaces as workspace
           on workspace.id = member.workspace_id
         join member_role_assignments as assignment
           on assignment.member_id = member.id
         join roles as role
           on role.id = assignment.role_id
         where account.id = $2::uuid
           and account.status = 'active'
           and member.status = 'active'
           and workspace.status in ('demo', 'active')
           and role.code = 'owner'
           and (role.workspace_id = $1::uuid or (role.workspace_id is null and role.is_system))
       ) as is_owner`,
      [tenant.workspaceDatabaseId, userId],
    );
    if (result.rowCount !== 1 || result.rows[0]?.is_owner !== true) return null;
    return Object.freeze({ userId, actorId: userId });
  } catch {
    failed = true;
    return null;
  } finally {
    client?.release(failed);
  }
}

// Request-scoped: call once per request with that request's identity source; never cache the result.
export async function createAuthenticatedOwnerReadRuntime(input: unknown): Promise<AuthenticatedOwnerReadDecision> {
  if (typeof window !== "undefined") return deny("unavailable");
  const config = exactOwnData(input, configurationFields);
  if (!config) return deny("unavailable");
  const domainWorkspaceId = config.domainWorkspaceId;
  if (typeof domainWorkspaceId !== "string" || !stableIdPattern.test(domainWorkspaceId)) return deny("unavailable");
  const connect = capturedMethod(config.database, "connect");
  const resolveIdentity = capturedMethod(config.identitySource, "resolve");
  if (!connect || !resolveIdentity) return deny("unavailable");
  const database: WorkflowRuntimeDatabase = Object.freeze({
    connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]>,
  });

  // 1. Tenant first: the trusted configuration, never the identity provider, chooses the workspace.
  let tenant: ResolvedWorkflowRuntimeTenant | null;
  try {
    tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domainWorkspaceId);
  } catch {
    tenant = null;
  }
  if (!tenant || !isResolvedWorkflowRuntimeTenant(tenant)) return deny("unavailable");

  // 2. Identity: exactly one call, no arguments, output treated as untrusted data.
  let userId: string | null;
  try {
    const output = classifyIdentityOutput(Reflect.apply(resolveIdentity, undefined, []));
    // Only a verified native Promise is awaited; its settled value is validated like a sync value.
    userId = output.kind === "rejected" ? null
      : authenticatedUserId(output.kind === "promise" ? await output.promise : output.value);
  } catch {
    userId = null;
  }
  if (!userId) return deny("unauthenticated");

  // 3. Current PAC facts for THIS tenant; every negative outcome is the same opaque denial.
  const principal = await verifyOwnerPrincipal(database, tenant, userId);
  if (!principal) return deny("unavailable");

  // 4. Delegate through AI-038.0 with the verified internal actor.
  const composed = createOwnerReadRuntimeForTenant({ database, tenant, ownerActorId: principal.actorId });
  return composed.verdict === "allow" && composed.backend
    ? Object.freeze({ verdict: "allow" as const, reason: null, backend: composed.backend })
    : deny("unavailable");
}
