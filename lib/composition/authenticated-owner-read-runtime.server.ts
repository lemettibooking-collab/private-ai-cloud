// AI-038.1: the application-facing entry for AUTHENTICATED Owner reads. Future UI/server requests
// use this entry (not the lower-level AI-038.0 entry). `server-only` makes any import of this module
// from a Client Component a build-time error.
import "server-only";

export { createAuthenticatedOwnerReadRuntime } from "./authenticated-owner-read-runtime";
export type { AuthenticatedIdentitySource, AuthenticatedOwnerReadDecision } from "./authenticated-owner-read-runtime";
export type { OwnerReadBackend } from "./owner-read-runtime";
