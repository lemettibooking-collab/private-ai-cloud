import type {
  WorkflowRuntimeResponse,
  WorkflowRuntimeService,
} from "./workflow-runtime-service";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { invalidWorkflowRuntimeCommandResponse, normalizeWorkflowRuntimeCommand, workflowRuntimeInternalFailureResponse } from "./workflow-runtime-service.ts";

export async function handleWorkflowRuntimeCommand(
  input: unknown,
  service: WorkflowRuntimeService,
): Promise<WorkflowRuntimeResponse> {
  const command = normalizeWorkflowRuntimeCommand(input);
  if (!command) return invalidWorkflowRuntimeCommandResponse();
  try {
    const result = await service.execute(command);
    return freezeModelProviderAdapterData(cloneModelProviderAdapterData(result));
  } catch {
    return workflowRuntimeInternalFailureResponse();
  }
}
