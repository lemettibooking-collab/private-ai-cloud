import "server-only";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorStartBoundary } from "../executors/executor-start-boundary.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createOpenAIAgentsTransport } from "../executors/openai-agents-executor.ts";

/** No route/action binding. Issuers stay inside trusted server composition, not on a caller-facing facade. */
export function createDevelopmentExecutorComposition(configuration: unknown, financialPolicy: unknown,
  settings: Parameters<typeof createOpenAIAgentsTransport>[1]) {
  const boundary = createExecutorStartBoundary(configuration, financialPolicy);
  const transport = createOpenAIAgentsTransport(boundary, settings);
  return Object.freeze({
    realDispatch: "blocked" as const,
    prepare(input: unknown, context: unknown) {
      const decision = boundary.validateInvocation(input);
      if (!decision.normalizedInvocation) return Object.freeze({ verdict: "deny" as const, reason: "executor_invocation_denied", prepared: null });
      return transport.prepare(decision.normalizedInvocation, context);
    },
    invoke() {
      // No reservation, credentials or external side effect until a durable executor fence exists.
      return Object.freeze({ verdict: "deny" as const, reason: "durable_executor_fence_required", normalizedResult: null });
    },
  });
}
