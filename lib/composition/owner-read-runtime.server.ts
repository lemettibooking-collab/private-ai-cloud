// AI-038.0: the ONLY application-facing entry of the Owner Read Backend Bundle. `server-only` makes
// any import of this module from a Client Component a build-time error (Next.js aliases the marker
// to a throwing module for client bundles and to an empty module for server code).
import "server-only";

export { createOwnerReadRuntime } from "./owner-read-runtime";
export type { OwnerReadBackend, OwnerReadRuntimeDecision } from "./owner-read-runtime";
