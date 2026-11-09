import { isProxy } from "node:util/types";
import type { OwnerProjectMutations, CreateProjectResult } from "../projects/owner-project-mutations";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createOwnerProjectMutations, projectCreationIntent } from "../projects/owner-project-mutations.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isProjectKey } from "../projects/project-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { pacIdentityFromProjection } from "../auth/auth-config.ts";

// The real Auth.js session is resolved ONCE by the request-scoped server entry, outside every
// database transaction. Copy only its validated primitive identity; no caller-owned object or
// later session resolution can replace the original subject after the mapping read.
function snapshotSession(session: unknown) {
  if (typeof session !== "object" || session === null || isProxy(session) || Array.isArray(session)) return null;
  const prototype = Object.getPrototypeOf(session);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(session).some(key => typeof key !== "string")) return null;
  const descriptor = Object.getOwnPropertyDescriptor(session, "pacIdentity");
  const identity = descriptor && Object.hasOwn(descriptor, "value") ? pacIdentityFromProjection(descriptor.value) : null;
  return identity ? Object.freeze({ pacIdentity: identity }) : null;
}

export function createGitHubOwnerProjectCreate(input: { database: unknown; domainWorkspaceId: string; session: unknown }): OwnerProjectMutations {
  if (typeof window !== "undefined") throw new Error("Owner project creation is server-only.");
  const session = snapshotSession(input.session);
  const identitySource = createGitHubSessionIdentitySource({ database: input.database, sessionResolver: { resolve: () => session } });
  return createOwnerProjectMutations({ database: input.database, domainWorkspaceId: input.domainWorkspaceId, identitySource, sessionIdentity: session?.pacIdentity ?? null });
}

export function projectCreateInputFromForm(input: unknown) {
  try {
    if (!(input instanceof FormData) || isProxy(input)) return null;
    let count = 0;
    for (const key of input.keys()) {
      if (++count > 32 || key.length > 128 || (!key.startsWith("$ACTION_") && key !== "projectId" && key !== "displayName")) return null;
    }
    const one = (key: string) => { const values = input.getAll(key); return values.length === 1 ? values[0] : null; };
    return projectCreationIntent({ projectId: one("projectId"), displayName: one("displayName") });
  } catch { return null; }
}

export function createOwnerProjectCreate(dependencies: Readonly<{
  workspaceSlug: unknown;
  withProjectCreate<T>(domainWorkspaceId: string, work: (binding: OwnerProjectMutations) => Promise<T>): Promise<T>;
}>) {
  const workspace = isProjectKey(dependencies.workspaceSlug) ? dependencies.workspaceSlug : null;
  const withProjectCreate = dependencies.withProjectCreate;
  return Object.freeze({
    async submit(form: unknown): Promise<CreateProjectResult> {
      const intent = projectCreateInputFromForm(form);
      if (!intent) return Object.freeze({ status: "invalid_input" as const });
      if (!workspace) return Object.freeze({ status: "unavailable" as const });
      try { return await withProjectCreate(workspace, binding => binding.createProject(intent)); }
      catch { return Object.freeze({ status: "unavailable" as const }); }
    },
  });
}
