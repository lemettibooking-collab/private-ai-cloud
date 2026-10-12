import { isProxy } from "node:util/types";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createAuthenticatedOwnerReadRuntime } from "./authenticated-owner-read-runtime.ts";
import type { AuthenticatedOwnerReadDecision } from "./authenticated-owner-read-runtime";

// AI-038.2a: request-scoped composition of the concrete GitHub session adapter with the AI-038.1
// authenticated Owner boundary. Call once per request; never cache the result. Application code
// uses `./github-owner-read-runtime.server`, which binds the real Auth.js `auth()` resolver.
export async function createGitHubOwnerReadRuntime(input: unknown): Promise<AuthenticatedOwnerReadDecision> {
  if (typeof window !== "undefined") return Object.freeze({ verdict: "deny" as const, reason: "unavailable" as const, backend: null });
  let config: { database: unknown; domainWorkspaceId: unknown; sessionResolver: unknown };
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) throw new Error("invalid");
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid");
    const keys = Reflect.ownKeys(input);
    const read = (key: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("invalid");
      return descriptor.value;
    };
    if (keys.length !== 3 || keys.some((key) => typeof key !== "string")) throw new Error("invalid");
    config = { database: read("database"), domainWorkspaceId: read("domainWorkspaceId"), sessionResolver: read("sessionResolver") };
  } catch {
    return Object.freeze({ verdict: "deny" as const, reason: "unavailable" as const, backend: null });
  }
  let identitySource;
  try {
    identitySource = createGitHubSessionIdentitySource({ sessionResolver: config.sessionResolver, database: config.database });
  } catch {
    return Object.freeze({ verdict: "deny" as const, reason: "unavailable" as const, backend: null });
  }
  return createAuthenticatedOwnerReadRuntime({
    database: config.database,
    domainWorkspaceId: config.domainWorkspaceId,
    identitySource,
  });
}
