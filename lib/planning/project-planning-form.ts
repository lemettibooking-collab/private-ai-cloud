// Transport is data only; Owner identity, source contents and workspace never come from a form.
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { projectResourceFields } from "../projects/project-resource-forms.ts";
const integer=(value:unknown)=>typeof value==="string"&&/^(0|[1-9][0-9]?)$/u.test(value)?Number(value):NaN;
export function projectPlanningForm(form:unknown,operation:"preview"|"save"|"decide"|"prepareAI") {
  const names=operation==="decide"?["projectId","revision","planFingerprint","decision"]:operation==="save"?["projectId","source","previewFingerprint","expectedRevision"]:["projectId","source"];
  const f=projectResourceFields(form,names);if(!f||Object.values(f).some(v=>typeof v!=="string"))return null;
  if(operation==="decide")return {projectId:f.projectId,revision:integer(f.revision),planFingerprint:f.planFingerprint,decision:f.decision};
  if(typeof f.source!=="string"||f.source.length>196)return null;
  const parts=f.source.split("|");if(parts.length!==3)return null;
  const selected={projectId:f.projectId,filename:parts[0],version:integer(parts[1]),sourceSha256:parts[2]};
  return operation==="save"?{...selected,previewFingerprint:f.previewFingerprint,expectedRevision:integer(f.expectedRevision)}:selected;
}
