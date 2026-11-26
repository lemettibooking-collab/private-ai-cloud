// Selector-only, bounded transport. No plans, mappings, graph, tenant or authority.
// @ts-expect-error Direct Node execution requires extension.
import { projectResourceFields } from '../projects/project-resource-forms.ts';
// @ts-expect-error Direct Node execution requires extension.
import { projectRoadmapSelector } from './project-roadmap-enrollment.ts';
export type ProjectRoadmapOperation='preview'|'enroll'|'ready';
export function projectRoadmapForm(raw:unknown,operation:ProjectRoadmapOperation){
 const names=['projectId','revision','planFingerprint','sourceFingerprint',...(operation==='preview'?[]:['previewFingerprint']),...(operation==='ready'?['taskId','expectedVersion','featurePlanId','featurePlanRevision','featurePlanFingerprint']:[])];
 const fields=projectResourceFields(raw,names);if(!fields||Object.values(fields).some(v=>typeof v!=='string'||v.length>128))return null;
 const f:Record<string,unknown>={...fields};
 for(const n of ['revision','expectedVersion','featurePlanRevision'])if(n in f){if(typeof f[n]!=='string'||!/^[1-9][0-9]{0,9}$/u.test(f[n] as string))return null;f[n]=Number(f[n]);}
 return projectRoadmapSelector(f,names.slice(4));
}
