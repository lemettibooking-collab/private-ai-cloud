// Server transport seam. Only server composition or a trusted test harness injects services.
import type { ProjectPlan } from '../planning/project-planning-contract';
import { randomBytes } from 'node:crypto';
// @ts-expect-error Direct Node execution requires extension.
import { projectGenerationForm } from '../planning/project-planning-form.ts';
import type { GenerationSource,GenerationView,GenerationOffer,ProjectGenerationOperation } from '../planning/project-planning-form';
type Backend={prepare:(raw:unknown)=>Promise<unknown>;generate:(raw:unknown)=>Promise<unknown>};
type Dependencies={authorize:(projectId:string)=>Promise<string>;read:(projectId:string,key:string)=>Promise<unknown>;backend?:Backend};
const statuses=new Set(['invalid_input','unauthenticated','authorization_denied','conflict','provider_unavailable','budget_denied','invalid_output','recovery_required','production_binding_unavailable']);
function projectResult(raw:unknown,key:string):GenerationView{
 const r=raw as {status?:string;proposal?:ProjectPlan|null;sources?:readonly GenerationSource[]};
 if(r?.status==='proposal_available'&&r.proposal&&r.sources)return{status:r.status,operationKey:key,proposal:r.proposal,sources:r.sources,runtimeDispatchAllowed:false};
 return{status:statuses.has(r?.status??'')?r.status!:'recovery_required',operationKey:key,runtimeDispatchAllowed:false};
}
export function createProjectGenerationActions(deps:Dependencies){
 return async(operation:ProjectGenerationOperation,form:unknown):Promise<GenerationView>=>{
  const input=projectGenerationForm(form,operation);if(!input)return{status:'invalid_input',runtimeDispatchAllowed:false};
  const key='operationKey' in input?input.operationKey:undefined;
  try{
   const authority=await deps.authorize(input.projectId);if(authority!=='ok')return{status:authority==='unauthenticated'?authority:'authorization_denied',operationKey:key,runtimeDispatchAllowed:false};
   if(operation==='read')return projectResult(await deps.read(input.projectId,key!),key!);
   if(!deps.backend)return{status:'production_binding_unavailable',operationKey:key,runtimeDispatchAllowed:false};
   if(operation==='prepare'){
    const r=await deps.backend.prepare(input) as {status:string;value?:GenerationOffer};
    if(r.status!=='ok'||!r.value)return projectResult(r,'');
    const v=r.value;
    return{status:'awaiting_authorization',operationKey:'pp-'+randomBytes(16).toString('hex'),offer:{sources:v.sources,preparationFingerprint:v.preparationFingerprint,offerFingerprint:v.offerFingerprint,policy:v.policy},runtimeDispatchAllowed:false};
   }
   return projectResult(await deps.backend.generate(input),key!);
  }catch{return{status:'recovery_required',operationKey:key,runtimeDispatchAllowed:false};}
 };
}
