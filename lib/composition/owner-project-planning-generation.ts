import type { ModelInvocationDataHandlingEvidenceResolver } from '../contracts/model-invocation-execution';
import type { ModelProvider, ModelProviderIdentity } from '../contracts/model-provider-adapter';
import type { WorkflowRuntimeDatabase } from '../db/workflow-runtime-store';
import type { ModelInvocationMessage } from '../contracts/model-invocation';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { oneShotOwnerEgressApproval } from './owner-egress-approval.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { canonicalUtc,createProjectGenerationRequests } from '../planning/project-planning-generation.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { createProjectOwnerAccess,snapshotProjectSession } from '../projects/project-owner-access.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { planDigest } from '../planning/project-planning-contract.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { projectGenerationPolicy } from './project-planning-generation-config.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { createPostgresWorkflowRuntimePersistence } from '../db/workflow-runtime-persistence.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { createWorkflowRuntimeService } from '../workflows/workflow-runtime-service.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { validateProviderClaimLeaseTiming } from '../contracts/provider-claim-lease-policy.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { createProjectGenerationRunState,planningRunIds,planningAdvanceCommand,planningRequirementsResolver,projectGenerationWorkflow as w } from '../planning/project-planning-generation-run.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { createModelInvocationRequestFingerprint } from '../contracts/model-invocation-data-handling.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { evaluateModelInvocationAdmission } from '../contracts/model-invocation.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { evaluateWorkflowRunTransition } from '../contracts/workflow-run.ts';

const identityKeys=['providerId','providerKind','deploymentId','providerModelId','providerRequestModelId','providerModelVersion'] as const;
const sameIdentity=(a:ModelProviderIdentity,b:ModelProviderIdentity)=>identityKeys.every(k=>a[k]===b[k]);
type EgressInput=Readonly<{ownerUserId:string;workspaceId:string;projectId:string;runId:string;stepId:string;invocationId:string;expectedIdentity:ModelProviderIdentity;sourceRequestFingerprint:string;runRevision:number;attemptNumber:number;modelProfileId:string;authorizedAt:string;expiresAt:string;attemptStartedAt:string;currentAuthority:()=>Promise<boolean>}>;
/** Only composed for the winning fresh request; never reconstructed during read/replay/recovery. */
export function projectGenerationEgress(input:EgressInput):ModelInvocationDataHandlingEvidenceResolver {
 const delegate=oneShotOwnerEgressApproval(input);
 let latched:Awaited<ReturnType<typeof delegate.resolve>>=null;
 let pending:Promise<Awaited<ReturnType<typeof delegate.resolve>>>|null=null;
 return Object.freeze({async resolve(request:Parameters<ModelInvocationDataHandlingEvidenceResolver['resolve']>[0]){
  if(request.sourceRequestFingerprint!==input.sourceRequestFingerprint||request.runRevision!==input.runRevision||request.attemptNumber!==input.attemptNumber||request.modelProfileId!==input.modelProfileId||request.runId!==input.runId||request.stepId!==input.stepId||request.invocationId!==input.invocationId||request.workspaceId!==input.workspaceId||request.projectId!==input.projectId||request.requirement!=='approval_required'||!sameIdentity(request.candidateIdentity,input.expectedIdentity))return null;
  const a=canonicalUtc(input.authorizedAt),e=canonicalUtc(input.expiresAt),s=canonicalUtc(input.attemptStartedAt),at=canonicalUtc(request.evaluatedAt);
  if(!a||!e||!s||!at||a>s||s>at||at>=e||Date.parse(at)>Date.now()||Date.parse(e)-Date.parse(a)>600000||e<=a||Date.now()<Date.parse(a)||Date.now()>=Date.parse(e))return null;
  if(!await input.currentAuthority()||Date.now()>=Date.parse(e))return null;
  if(latched)return at>=latched.decidedAt?latched:null;
  pending??=(async()=>{const evidence=await delegate.resolve(request);if(!evidence)return null;latched=Object.freeze({...evidence,expiresAt:e});return latched;})();
  return pending;
 }});
}

/** Trusted test/server composition only; no route, environment credential lookup or production binding. */
export function createProjectPlanningGeneration(config:Readonly<{database:WorkflowRuntimeDatabase;domainWorkspaceId:string;session:unknown;policy:()=>unknown;provider:ModelProvider}>){
 const session=snapshotProjectSession(config.session);
 const access=createProjectOwnerAccess({database:config.database,domainWorkspaceId:config.domainWorkspaceId,session});
 const requests=createProjectGenerationRequests({access,domainWorkspaceId:config.domainWorkspaceId,identityFingerprint:planDigest(session?.pacIdentity??null),policy:config.policy});
 async function generate(raw:unknown){
  // Never accepts a real provider, even if an injected configuration is accidentally broadened.
  const p=projectGenerationPolicy(config.policy());
  if(!p||config.provider.identity.providerKind!=='mock'||!sameIdentity(config.provider.identity,p.identity))return{status:'provider_unavailable'};
  const begun=await requests.begin(raw);if(begun.status!=='ok')return{status:begun.status};
  const row=begun.value.row,projectId=row.project_key as string,key=row.operation_key as string;
  if(begun.value.kind==='replayed')return read(projectId,key);
  let advancing=false;
  try{
   const admitted=await requests.admit(projectId,key);if(admitted.status!=='ok'){await requests.settle(projectId,key,'authorization_denied',null);return{status:'authorization_denied'};}
   const v=admitted.value,ids=planningRunIds(row.run_id as string);
   const timing=validateProviderClaimLeaseTiming({providerTimeoutMs:120000,claimLeaseDurationMs:300000}).timing;
   if(!timing)return{status:'recovery_required'};
   const persistence=await createPostgresWorkflowRuntimePersistence({database:config.database,domainWorkspaceId:config.domainWorkspaceId,providerExecutionTiming:timing});
   if(!persistence)return{status:'recovery_required'};
   const state=createProjectGenerationRunState({workspaceId:config.domainWorkspaceId,planningKey:ids.runId,project:{projectId,displayName:v.projectName},createdAt:new Date().toISOString(),policy:v.policy});
   if(!state)return{status:'recovery_required'};
   let expectedFingerprint:string|null=null,attemptStartedAt:string|null=null,expectedRevision:number|null=null;
   const now=()=>new Date().toISOString();
   let egress:ModelInvocationDataHandlingEvidenceResolver|null=null;
   const service=createWorkflowRuntimeService({store:persistence.stateStore,providers:[config.provider],authorizer:{authorize:command=>command.actorId===v.ownerUserId&&command.runId===ids.runId&&['start','advance'].includes(command.action)},requirementsResolver:planningRequirementsResolver(v.policy),runtimeContext:{now},evidenceResolver:{async resolve(request){
    if(!expectedFingerprint||expectedRevision===null)return null;
    // Agent Step Runtime uses the same trusted occurredAt for step_started and evaluation.
    attemptStartedAt??=request.evaluatedAt;
    egress??=projectGenerationEgress({ownerUserId:v.ownerUserId,workspaceId:config.domainWorkspaceId,projectId,runId:ids.runId,stepId:ids.stepId,invocationId:ids.invocationId,expectedIdentity:v.policy.identity,sourceRequestFingerprint:expectedFingerprint,runRevision:expectedRevision,attemptNumber:1,modelProfileId:w.modelProfileId,authorizedAt:v.authorizedAt,expiresAt:v.expiresAt,attemptStartedAt,currentAuthority:async()=> (await requests.admit(projectId,key)).status==='ok'});
    return egress.resolve(request);
   }}});
   await persistence.stateStore.create({state});
   const started=await service.start({kind:'start',commandId:ids.startCommandId,runId:ids.runId,expectedRevision:0,actorId:v.ownerUserId});
   if(started.status!=='running'||started.revision===null)return{status:'recovery_required'};
   const loaded=await persistence.stateStore.load({runId:ids.runId}) as {snapshot:NonNullable<ReturnType<typeof createProjectGenerationRunState>>['snapshot']}|null;if(!loaded)return{status:'recovery_required'};
   // Derive exact invocation using canonical transition/admission, rather than trust resolver input.
   const predicted=evaluateWorkflowRunTransition({snapshot:loaded.snapshot,event:{eventId:ids.executionId+'-prediction',runId:ids.runId,kind:'step_started',sequence:loaded.snapshot.revision+1,occurredAt:now(),actorKind:'system',actorId:'workflow-runtime',stepId:ids.stepId}});
   if(!predicted.nextSnapshot)return{status:'recovery_required'};
   const command=planningAdvanceCommand(ids.runId,v.ownerUserId,started.revision,v.prepared.messages as readonly ModelInvocationMessage[]);
   const invocation=evaluateModelInvocationAdmission({snapshot:predicted.nextSnapshot,draft:command.agentInputs[0].invocationDraft,existingRequests:[]}).normalizedRequest;
   if(!invocation)return{status:'recovery_required'};
   expectedFingerprint=createModelInvocationRequestFingerprint(invocation);expectedRevision=invocation.runRevision;
   if(expectedFingerprint!==row.runtime_request_fingerprint||(await requests.admit(projectId,key)).status!=='ok')return{status:'authorization_denied'};
   advancing=true;
   const response=await service.advance(command);
   const result=await persistence.stateStore.readModelInvocationResult({runId:ids.runId,invocationId:ids.invocationId});
   if(response.status==='completed'&&result?.status==='succeeded'&&result.outputText!==null){
    const settled=await requests.settle(projectId,key,'proposal_available',result.outputText);
    return settled.status==='ok'?read(projectId,key):{status:'recovery_required'};
   }
   const status=result?.status==='failed'&&result.errorCode==='generation_not_authorized'?'budget_denied':result?.status==='failed'?'provider_unavailable':'recovery_required';
   const settled=await requests.settle(projectId,key,status,null);return{status:settled.status==='ok'?status:'recovery_required'};
  }catch{
   await requests.settle(projectId,key,advancing?'recovery_required':'provider_unavailable',null);
   return{status:'recovery_required'};
  }
 }
 async function read(projectId:string,key:string){const r=await requests.read(projectId,key);return r.status==='ok'?r.value:{status:r.status==='unavailable'?'recovery_required':r.status};}
 return Object.freeze({prepare:requests.prepare,generate,read,runtimeDispatchAllowed:false as const});
}
