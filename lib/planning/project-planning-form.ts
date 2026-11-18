// Transport is data only; Owner identity, source contents and workspace never come from a form.
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { projectResourceFields } from "../projects/project-resource-forms.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { exactOwnData } from "../db/executor-start-transaction.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { captureRoadmapData } from "../roadmap/roadmap-contract.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { isProjectKey } from "../projects/project-registry.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { isDocumentFilename } from "../projects/project-knowledge.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { parsePlanningJSON } from "./project-planning-contract.ts";

type AISource = Readonly<{filename:string;version:number;sha256:string}>;
// Detached selectors only. This normalization confers no read or execution authority.
export function projectAIPlanningInput(raw:unknown) {
  try {
    const f=exactOwnData(raw,["projectId","sources"]);
    if(!f||!isProjectKey(f.projectId))return null;
    const captured=captureRoadmapData(f.sources);
    if(!Array.isArray(captured)||captured.length<1||captured.length>4)return null;
    const names=new Set<string>(),sources:AISource[]=[];
    for(const value of captured){
      const source=exactOwnData(value,["filename","version","sha256"]);
      if(!source||!isDocumentFilename(source.filename)||!Number.isInteger(source.version)||(source.version as number)<1||(source.version as number)>50
        ||typeof source.sha256!=="string"||!/^[a-f0-9]{64}$/u.test(source.sha256)||names.has(source.filename))return null;
      names.add(source.filename);sources.push(Object.freeze({filename:source.filename,version:source.version as number,sha256:source.sha256}));
    }
    if(Buffer.byteLength(JSON.stringify(sources),"utf8")>2048)return null;
    // Exact lexical filename order fixes the sourceReferences order for any future generation.
    sources.sort((a,b)=>a.filename===b.filename?0:a.filename<b.filename?-1:1);
    return Object.freeze({projectId:f.projectId,sources:Object.freeze(sources)});
  }catch{return null;}
}
const integer=(value:unknown)=>typeof value==="string"&&/^(0|[1-9][0-9]?)$/u.test(value)?Number(value):NaN;
export function projectPlanningForm(form:unknown,operation:"preview"|"save"|"decide"|"prepareAI"|"saveGenerated") {
  const names=operation==="saveGenerated"?["projectId","operationKey","planFingerprint","expectedRevision"]:operation==="prepareAI"?["projectId","sources"]:operation==="decide"?["projectId","revision","planFingerprint","decision"]:operation==="save"?["projectId","source","previewFingerprint","expectedRevision"]:["projectId","source"];
  const f=projectResourceFields(form,names);if(!f||Object.values(f).some(v=>typeof v!=="string"))return null;
  if(operation==='saveGenerated'){
    const keys=[...FormData.prototype.keys.call(form as FormData)].filter(k=>!k.startsWith('$ACTION_'));
    if(new Set(keys).size!==keys.length)return null;
    return {projectId:f.projectId,operationKey:f.operationKey,planFingerprint:f.planFingerprint,expectedRevision:integer(f.expectedRevision)};
  }
  if(operation==="prepareAI"){
    if(typeof f.sources!=="string"||Buffer.byteLength(f.sources,"utf8")>2048)return null;
    const keys=[...FormData.prototype.keys.call(form as FormData)];if(new Set(keys).size!==keys.length)return null;
    try{return projectAIPlanningInput({projectId:f.projectId,sources:parsePlanningJSON(f.sources)});}catch{return null;}
  }
  if(operation==="decide")return {projectId:f.projectId,revision:integer(f.revision),planFingerprint:f.planFingerprint,decision:f.decision};
  if(typeof f.source!=="string"||f.source.length>196)return null;
  const parts=f.source.split("|");if(parts.length!==3)return null;
  const selected={projectId:f.projectId,filename:parts[0],version:integer(parts[1]),sourceSha256:parts[2]};
  return operation==="save"?{...selected,previewFingerprint:f.previewFingerprint,expectedRevision:integer(f.expectedRevision)}:selected;
}

export type ProjectGenerationOperation="prepare"|"generate"|"read";
export function projectGenerationForm(form:unknown,operation:ProjectGenerationOperation){
 try{
  const names=operation==="read"?["projectId","operationKey"]:operation==="prepare"?["projectId","sources"]:["projectId","sources","operationKey","offerFingerprint","consent"];
  const f=projectResourceFields(form,names);if(!f)return null;
  let totalBytes=0;
  for(const [name,value] of FormData.prototype.entries.call(form as FormData)){
   if(typeof value!=="string"||Buffer.byteLength(value,"utf8")>16384)return null;
   totalBytes+=Buffer.byteLength(name,"utf8")+Buffer.byteLength(value,"utf8");if(totalBytes>32768)return null;
  }
  if(Object.values(f).some(v=>typeof v!=="string"||Buffer.byteLength(v,"utf8")>2048)||!isProjectKey(f.projectId))return null;
  const keys=[...FormData.prototype.keys.call(form as FormData)].filter(k=>!k.startsWith("$ACTION_"));
  if(new Set(keys).size!==keys.length)return null;
  if(operation!=="prepare"&&(typeof f.operationKey!=="string"||!/^pp-[a-f0-9]{32}$/u.test(f.operationKey)))return null;
  if(operation==="read")return{projectId:f.projectId,operationKey:f.operationKey as string};
  const selected=projectAIPlanningInput({projectId:f.projectId,sources:parsePlanningJSON(f.sources as string)});if(!selected)return null;
  if(operation==="prepare")return selected;
  if(f.consent!=="true"||typeof f.offerFingerprint!=="string"||!/^[a-f0-9]{64}$/u.test(f.offerFingerprint))return null;
  return{...selected,operationKey:f.operationKey as string,offerFingerprint:f.offerFingerprint,consent:true as const};
 }catch{return null;}
}

import type { ProjectGenerationPolicy } from '../composition/project-planning-generation-config';
import type { ProjectPlan } from './project-planning-contract';
export type GenerationSource=Readonly<{filename:string;version:number;sha256:string}>;
export type GenerationOffer=Readonly<{sources:readonly GenerationSource[];preparationFingerprint:string;offerFingerprint:string;policy:ProjectGenerationPolicy}>;
export type GenerationView={status:string;operationKey?:string;offer?:GenerationOffer;proposal?:ProjectPlan;sources?:readonly GenerationSource[];planFingerprint?:string;expectedRevision?:number;runtimeDispatchAllowed?:false};
