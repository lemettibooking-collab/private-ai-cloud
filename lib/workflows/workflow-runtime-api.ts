import type {
  AuthorizedWorkflowRuntimeAccess,
  WorkflowRuntimeAccessDecision,
  WorkflowRuntimePublicCommandResponse,
} from "./workflow-runtime-access";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";

function unavailable(): WorkflowRuntimeAccessDecision<WorkflowRuntimePublicCommandResponse> {
  return freezeModelProviderAdapterData({
    verdict: "deny" as const,
    status: "unavailable" as const,
    data: null,
  });
}

export async function handleWorkflowRuntimeCommand(
  input: unknown,
  accessContext: unknown,
  access: AuthorizedWorkflowRuntimeAccess,
): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicCommandResponse>> {
  try {
    return await access.executeCommand(accessContext, input);
  } catch {
    return unavailable();
  }
}
