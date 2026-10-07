// AI-038.2a: application-facing entry for Owner reads authenticated by the Auth.js GitHub session.
// Server-only. The session resolver is the real Auth.js `auth()` for the CURRENT request; call this
// once per request and discard the result.
import "server-only";
import { auth } from "../auth/next-auth.server";
import { createGitHubOwnerReadRuntime } from "./github-owner-read-runtime";

export type { AuthenticatedOwnerReadDecision, OwnerReadBackend } from "./authenticated-owner-read-runtime.server";

export function createRequestOwnerReadRuntime(input: Readonly<{ database: unknown; domainWorkspaceId: string }>) {
  return createGitHubOwnerReadRuntime({
    database: input.database,
    domainWorkspaceId: input.domainWorkspaceId,
    sessionResolver: { resolve: () => auth() },
  });
}
