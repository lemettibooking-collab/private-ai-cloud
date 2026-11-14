import "server-only";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createAI044BlockedProofComposition } from "../executors/ai044-readiness.ts";

/** Intentionally has no credential resolver, provider client, uploader or dispatch port.
 * No live issuer exists while total financial exposure remains unproven. */
export const createAI044OpenAIProofComposition = createAI044BlockedProofComposition;
