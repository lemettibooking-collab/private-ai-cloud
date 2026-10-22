// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { blockedExecutorReconciliation } from "../executors/openai-agents-reconciliation.ts";

/** Production remains structurally unavailable. No client, credential or caller unlock. */
export function createExecutorProviderReconciliationComposition() {
  return Object.freeze({ realDispatch: "blocked" as const, realRetrieval: "blocked" as const,
    reconcile: async () => blockedExecutorReconciliation() });
}
