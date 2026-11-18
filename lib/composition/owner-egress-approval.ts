// AI-039.1: explicit Owner data-egress approval for ONE model invocation (approved_minimum).
//
// The Owner approves the egress in the request that starts the invocation (the planning form's
// explicit consent; recorded durably by the planning request and its audit event). This resolver
// turns that approval into the data-handling evidence the runtime requires. Same rules as the M2
// smoke approval (lib/composition/real-provider-smoke.ts):
// * bound to exactly one workspace, project, Run, Step, invocation, revision, attempt, model profile,
//   candidate provider identity and source request fingerprint — anything else gets null;
// * one-shot and NON-RENEWABLE: the first matching resolution latches one immutable evidence object
//   (decidedAt = that first evaluation time, expiresAt = decidedAt + validity); later resolutions
//   return that same object only while every binding still matches; an expired latch is returned
//   unchanged so the data-handling contract denies it; a replacement is never minted;
// * process-local: lost on restart (a restarted request never inherits an approval).
import type { ModelInvocationDataHandlingEvidenceResolverInput } from "../contracts/model-invocation-execution";
import type { ModelProviderIdentity } from "../contracts/model-provider-adapter";

const identityFields = [
  "providerId", "providerKind", "deploymentId", "providerModelId", "providerRequestModelId", "providerModelVersion",
] as const;

function sameIdentity(left: ModelProviderIdentity, right: ModelProviderIdentity): boolean {
  return identityFields.every((field) => left[field] === right[field]);
}

type LatchedEgressApproval = Readonly<{
  kind: "approval"; evidenceId: string; approvalRequestId: string; status: "approved";
  workspaceId: string; projectId: string; runId: string; invocationId: string; runRevision: number;
  stepId: string; attemptNumber: number; modelProfileId: string; candidateIdentity: ModelProviderIdentity;
  sourceRequestFingerprint: string; purpose: "model_data_egress"; approvedByActorKind: "owner";
  approvedByActorId: string; decidedAt: string; expiresAt: string; reason: null;
}>;

export const ownerEgressApprovalValidityMs = 10 * 60 * 1_000;

export function oneShotOwnerEgressApproval(input: Readonly<{
  ownerUserId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  stepId: string;
  invocationId: string;
  expectedIdentity: ModelProviderIdentity;
}>) {
  const expectedIdentity: ModelProviderIdentity = Object.freeze(
    Object.fromEntries(identityFields.map((field) => [field, input.expectedIdentity[field]])) as ModelProviderIdentity,
  );
  const { ownerUserId, workspaceId, projectId, runId, stepId, invocationId } = input;
  let latched: LatchedEgressApproval | null = null;
  return Object.freeze({
    async resolve(request: ModelInvocationDataHandlingEvidenceResolverInput) {
      if (request.requirement !== "approval_required" || request.workspaceId !== workspaceId || request.projectId !== projectId
        || request.runId !== runId || request.stepId !== stepId || request.invocationId !== invocationId
        || !sameIdentity(request.candidateIdentity, expectedIdentity)) return null;
      if (latched) {
        const bound = request.runRevision === latched.runRevision && request.attemptNumber === latched.attemptNumber
          && request.modelProfileId === latched.modelProfileId
          && request.sourceRequestFingerprint === latched.sourceRequestFingerprint;
        return bound ? latched : null;
      }
      const decidedMs = Date.parse(request.evaluatedAt);
      if (!Number.isFinite(decidedMs)) return null;
      latched = Object.freeze({
        kind: "approval",
        evidenceId: `${invocationId}-egress`,
        approvalRequestId: `${invocationId}-egress-request`,
        status: "approved",
        workspaceId,
        projectId,
        runId,
        invocationId,
        runRevision: request.runRevision,
        stepId,
        attemptNumber: request.attemptNumber,
        modelProfileId: request.modelProfileId,
        candidateIdentity: expectedIdentity,
        sourceRequestFingerprint: request.sourceRequestFingerprint,
        purpose: "model_data_egress",
        approvedByActorKind: "owner",
        approvedByActorId: ownerUserId,
        decidedAt: new Date(decidedMs).toISOString(),
        expiresAt: new Date(decidedMs + ownerEgressApprovalValidityMs).toISOString(),
        reason: null, // the contract requires a null reason on approved evidence
      });
      return latched;
    },
  });
}
