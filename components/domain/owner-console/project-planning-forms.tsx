"use client";
import { useActionState,useState } from "react";
import type { PlanningValidation } from "@/lib/planning/project-planning-contract";
import type { ProjectPlanningCopy } from "@/lib/i18n/project-planning-copy";
type Source={filename:string;version:number;sha256:string};
type Preview={validation:PlanningValidation;source:Source;sourceFingerprint:string;previewFingerprint:string;expectedRevision:number};
type State={status:string;preview?:Preview;prepared?:{requestFingerprint:string;sources:readonly Source[];sourceBytes:number}};
type Action=(previous:unknown,form:FormData)=>Promise<State>;
const sourceKey=(s:Source)=>`${s.filename}|${s.version}|${s.sha256}`;
const control="pac-control block w-full p-2 text-sm";
function Message({state,c}:{state:State;c:ProjectPlanningCopy}){return state.status==="idle"?null:<p aria-live="polite" className="text-sm text-ink-2" role="status">{c[state.status as keyof ProjectPlanningCopy]??c.unavailable}</p>;}
export function PlanningSourceForm({projectId,sources,c,previewAction,saveAction,aiAction}:{projectId:string;sources:readonly Source[];c:ProjectPlanningCopy;previewAction:Action;saveAction:Action;aiAction:Action}){
 const[selected,setSelected]=useState(sources[0]?sourceKey(sources[0]):"");
 return <div className="space-y-4"><label className="block text-sm">{c.source}<select className={control} onChange={e=>setSelected(e.target.value)} value={selected}>{sources.map(s=><option key={sourceKey(s)} value={sourceKey(s)}>{s.filename} · {s.version} · {s.sha256}</option>)}</select></label>
 <ImportPreview c={c} key={selected} previewAction={previewAction} projectId={projectId} saveAction={saveAction} source={selected}/><AIPlanningSources aiAction={aiAction} c={c} projectId={projectId} sources={sources}/></div>;
}
function ImportPreview({projectId,source,c,previewAction,saveAction}:{projectId:string;source:string;c:ProjectPlanningCopy;previewAction:Action;saveAction:Action}){
 const[state,preview,pending]=useActionState<State,FormData>(previewAction,{status:"idle"});
 const p=state.preview;
 return <div className="space-y-4"><form action={preview}><input name="projectId" type="hidden" value={projectId}/><input name="source" type="hidden" value={source}/><button className={control} disabled={pending||!source} type="submit">{pending?c.saving:c.preview}</button><Message c={c} state={state}/></form>
 {p&&<div className="space-y-3"><p className="text-sm">{c.previewReady}</p><p className="break-all text-xs">{p.source.filename} · {p.source.version} · {c.sourceHash}: {p.source.sha256}</p>
 <p className="text-sm">{c.accepted}: {p.validation.accepted} · {c.rejectedRecords}: {p.validation.rejected} · {c.pending}: {p.validation.pending}</p>
 <ul className="text-sm">{p.validation.findings.map((f,i)=><li key={i}>{c[f.code]} · {f.path}</li>)}</ul>
 <ul className="text-sm text-ink-3">{p.validation.warnings.map(w=><li key={w}>{c[w as keyof ProjectPlanningCopy]??c.unavailable}</li>)}</ul>
 <ul className="space-y-2 text-sm">{p.validation.tasks.map((t,i)=><li key={i}><strong>{t.id} · {t.title} · {t.priority}</strong><p>{c.goal}: {t.goal}</p><p>{t.description}</p><p>{c.dependencies}: {t.dependencyIds.join(", ")}</p><p>{c.criteria}: {t.acceptanceCriteria.join("; ")}</p><p>{c.scope}: {t.scope.join("; ")}</p></li>)}</ul>
 {p.validation.plan&&<SaveForm c={c} preview={p} projectId={projectId} saveAction={saveAction}/>}</div>}
 </div>;
}
function AIPlanningSources({projectId,sources,c,aiAction}:{projectId:string;sources:readonly Source[];c:ProjectPlanningCopy;aiAction:Action}){
 const[selected,setSelected]=useState<string[]>([]);
 const chosen=sources.filter(s=>selected.includes(sourceKey(s)));
 const valid=chosen.length!==0&&chosen.length<=4&&chosen.length===selected.length&&new Set(chosen.map(s=>s.filename)).size===chosen.length;
 return <div className="border-t border-line pt-4"><h3 className="font-semibold">{c.ai}</h3>
 <p className="my-2 text-sm text-ink-2">{c.blocked}</p><p className="mb-3 text-sm text-ink-3">{c.aiDetail}</p>
 <label className="block text-sm">{c.aiSources}<select aria-label={c.aiSources} className={control} multiple onChange={e=>setSelected(Array.from(e.currentTarget.selectedOptions,option=>option.value))} size={Math.min(8,Math.max(2,sources.length))} value={selected}>
 {sources.map(s=><option key={sourceKey(s)} value={sourceKey(s)}>{s.filename} · {s.version} · {s.sha256}</option>)}
 </select></label><p className="my-2 text-sm text-ink-3">{c.aiSelectionHelp}</p>
 {selected.length>0&&!valid&&<p className="text-sm" role="alert">{c.aiInvalid}</p>}
 <AIPrepareForm action={aiAction} c={c} key={JSON.stringify([projectId,chosen])} projectId={projectId} sources={chosen} valid={valid}/></div>;
}
function AIPrepareForm({projectId,sources,valid,c,action:submit}:{projectId:string;sources:readonly Source[];valid:boolean;c:ProjectPlanningCopy;action:Action}){
 const[state,action,pending]=useActionState<State,FormData>(submit,{status:"idle"});
 return <form action={action}><input name="projectId" type="hidden" value={projectId}/><input name="sources" type="hidden" value={JSON.stringify(sources)}/>
 <button className={control} disabled={pending||!valid} type="submit">{pending?c.saving:c.prepareAI}</button><Message c={{...c,invalid_input:c.aiInvalid}} state={state}/>
 {state.prepared&&<div className="space-y-2 text-xs"><p className="break-all">{c.requestHash}: {state.prepared.requestFingerprint}</p><p>{c.sourceBytes}: {state.prepared.sourceBytes}</p>
 <ul>{state.prepared.sources.map(s=><li className="break-all" key={sourceKey(s)}>{s.filename} · {s.version} · {c.sourceHash}: {s.sha256}</li>)}</ul></div>}</form>;
}

function SaveForm({projectId,preview,c,saveAction}:{projectId:string;preview:Preview;c:ProjectPlanningCopy;saveAction:Action}){
 const[state,action,pending]=useActionState<State,FormData>(saveAction,{status:"idle"});
 return <form action={action}><input name="projectId" type="hidden" value={projectId}/><input name="source" type="hidden" value={sourceKey(preview.source)}/><input name="previewFingerprint" type="hidden" value={preview.previewFingerprint}/><input name="expectedRevision" type="hidden" value={preview.expectedRevision}/><button className={control} disabled={pending} type="submit">{pending?c.saving:c.save}</button><Message c={c} state={state}/></form>;
}
export function PlanningDecisionForm({projectId,revision,planFingerprint,canApprove,c,action:submit}:{projectId:string;revision:number;planFingerprint:string;canApprove:boolean;c:ProjectPlanningCopy;action:Action}){
 const[state,action,pending]=useActionState<State,FormData>(submit,{status:"idle"});
 return <form action={action} className="space-y-3"><input name="projectId" type="hidden" value={projectId}/><input name="revision" type="hidden" value={revision}/><input name="planFingerprint" type="hidden" value={planFingerprint}/>{canApprove&&<button className={control} disabled={pending} name="decision" type="submit" value="approved">{c.approve}</button>}<button className={control} disabled={pending} name="decision" type="submit" value="rejected">{c.reject}</button><Message c={c} state={state}/></form>;
}
