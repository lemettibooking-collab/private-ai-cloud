import type { PostgresExecutorConfiguration } from "../db/executor-start-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresExecutorStartStore } from "../db/executor-start-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorOutcomeCapture } from "../executors/executor-outcome.ts";

/** Internal, presently UNBOUND producer ingress. Trusted server configuration, not caller flags.
 * A future transport/reconciler must supply factual terminality; no polling or dispatch here. */
export function createDurableExecutorOutcomeIngress(configuration: Omit<PostgresExecutorConfiguration, "authorizeStart">, trustedProducer: unknown) {
  if (typeof window !== "undefined") throw Error("executor_outcome_server_only");
  const capture = createExecutorOutcomeCapture(configuration.configuration, trustedProducer);
  const store = createPostgresExecutorStartStore({ ...configuration, authorizeStart: () => false });
  return Object.freeze({
    async recordOutcome(rawInvocation: unknown, requestFingerprint: unknown) {
      const receipt = await capture.capture(rawInvocation, requestFingerprint);
      return store.recordDefinitiveOutcomeAndSettle(rawInvocation, requestFingerprint, receipt);
    },
    inspectOutcome: store.inspectOutcome,
    realDispatch: "blocked" as const,
  });
}
