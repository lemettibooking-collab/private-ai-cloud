import { isProxy } from "node:util/types";
import type { AuthenticatedIdentitySource } from "../composition/authenticated-owner-read-runtime";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { pacIdentityFromProjection } from "./auth-config.ts";

// AI-038.2a concrete AI-038.1 identity source for the Auth.js GitHub session.
//
//   verified Auth.js server session (sessionResolver.resolve(), request-scoped)
//     → ONLY session.pacIdentity = { provider: "github", providerSubject: <GitHub account id> }
//     → auth_identities (provider, provider_subject, status = 'active') → PAC users.id
//     → { userId } for AI-038.1 (membership + Owner role are verified there, per tenant)
//
// The session is untrusted structure at this boundary even though Auth.js verified it: Proxy,
// accessors, arrays, class instances and malformed identities are rejected without executing them.
// No email, login, name, role, workspace or token is ever read. No workspace is looked up here.

export interface AuthSessionResolver {
  resolve(): Promise<unknown> | unknown;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

// Synchronous, wrapper-returning classifier: never `await` or return an arbitrary thenable (that
// would invoke its `then`). Only a genuine native Promise is awaited.
function classify(raw: unknown):
  | Readonly<{ kind: "value"; value: unknown }> | Readonly<{ kind: "promise"; promise: Promise<unknown> }> | Readonly<{ kind: "rejected" }> {
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

// Only the `pacIdentity` own data property of an ordinary non-Proxy session object is read.
function sessionIdentity(session: unknown) {
  try {
    if (typeof session !== "object" || session === null || isProxy(session) || Array.isArray(session)) return null;
    const prototype = Object.getPrototypeOf(session);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Reflect.ownKeys(session).some((key) => typeof key !== "string")) return null;
    const descriptor = Object.getOwnPropertyDescriptor(session, "pacIdentity");
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    return pacIdentityFromProjection(descriptor.value);
  } catch {
    return null;
  }
}

export function createGitHubSessionIdentitySource(input: unknown): AuthenticatedIdentitySource {
  const resolveSession = (() => {
    try {
      if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return null;
      const keys = Reflect.ownKeys(input);
      if (keys.length !== 2 || !keys.includes("sessionResolver") || !keys.includes("database")) return null;
      const resolver = Object.getOwnPropertyDescriptor(input, "sessionResolver");
      const database = Object.getOwnPropertyDescriptor(input, "database");
      if (!resolver || !Object.hasOwn(resolver, "value") || !database || !Object.hasOwn(database, "value")) return null;
      const resolve = capturedMethod(resolver.value, "resolve");
      const connect = capturedMethod(database.value, "connect");
      return resolve && connect ? { resolve, connect } : null;
    } catch {
      return null;
    }
  })();
  if (!resolveSession) throw new Error("GitHub session identity source configuration is invalid.");
  const { resolve, connect } = resolveSession;
  // Receiver-free, frozen captures: the caller's objects are never retained as authority.
  const database: WorkflowRuntimeDatabase = Object.freeze({
    connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]>,
  });

  async function resolveIdentity(): Promise<Readonly<{ userId: string }> | null> {
    let identity;
    try {
      const output = classify(Reflect.apply(resolve, undefined, []));
      identity = output.kind === "rejected" ? null
        : sessionIdentity(output.kind === "promise" ? await output.promise : output.value);
    } catch {
      identity = null;
    }
    if (!identity) return null;
    let client: WorkflowRuntimeSqlClient | null = null;
    let failed = false;
    try {
      client = await database.connect();
      const result = await client.query<{ user_id: unknown }>(
        `/* auth-identity:resolve */
         select user_id::text as user_id
         from auth_identities
         where provider = $1 and provider_subject = $2 and status = 'active'
         limit 2`,
        [identity.provider, identity.providerSubject],
      );
      if (result.rowCount !== 1 || result.rows.length !== 1) return null;
      const userId = result.rows[0].user_id;
      return typeof userId === "string" && uuidPattern.test(userId) ? Object.freeze({ userId }) : null;
    } catch {
      failed = true;
      return null;
    } finally {
      client?.release(failed);
    }
  }

  return Object.freeze({ resolve: resolveIdentity });
}
