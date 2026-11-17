"use client";
import type { ComponentProps } from "react";
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
export function PlanningSourceForm({projectId,sources,c,previewAction,saveAction,aiAction,hideAI=false,generation}:{generation?:ComponentProps<typeof ProjectPlanningGenerationForm>;hideAI?:boolean;projectId:string;sources:readonly Source[];c:ProjectPlanningCopy;previewAction:Action;saveAction:Action;aiAction:Action}){
 const[selected,setSelected]=useState(sources[0]?sourceKey(sources[0]):"");
 if(generation)return <ProjectPlanningGenerationForm key={generation.projectId} {...generation}/>;
 return <div className="space-y-4"><label className="block text-sm">{c.source}<select className={control} onChange={e=>setSelected(e.target.value)} value={selected}>{sources.map(s=><option key={sourceKey(s)} value={sourceKey(s)}>{s.filename} · {s.version} · {s.sha256}</option>)}</select></label>
 <ImportPreview c={c} key={selected} previewAction={previewAction} projectId={projectId} saveAction={saveAction} source={selected}/>{!hideAI&&<AIPlanningSources aiAction={aiAction} c={c} projectId={projectId} sources={sources}/>}</div>;
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
 <PlanningMultiSourceSelect c={c} sources={sources} selected={selected} onChange={setSelected}/><p className="my-2 text-sm text-ink-3">{c.aiSelectionHelp}</p>
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

export function PlanningMultiSourceSelect({c,sources,selected,onChange,disabled=false}:{c:ProjectPlanningCopy;sources:readonly Source[];selected:string[];onChange:(value:string[])=>void;disabled?:boolean}){
 return <label className="block text-sm">{c.aiSources}<select aria-label={c.aiSources} className={control} multiple disabled={disabled} onChange={e=>onChange(Array.from(e.currentTarget.selectedOptions,o=>o.value))} size={Math.min(8,Math.max(2,sources.length))} value={selected}>{sources.map(s=><option key={sourceKey(s)} value={sourceKey(s)}>{s.filename} · {s.version} · {s.sha256}</option>)}</select></label>;
}

import type { GenerationView,GenerationOffer,GenerationSource } from '@/lib/planning/project-planning-form';
import type { ProjectGenerationCopy } from '@/lib/i18n/project-planning-copy';
type GenerationAction=(previous:unknown,form:FormData)=>Promise<GenerationView>;
type Props={projectId:string;sources:readonly GenerationSource[];c:ProjectPlanningCopy;g:ProjectGenerationCopy;prepareAction:GenerationAction;generateAction:GenerationAction;readAction:GenerationAction;operationKey?:string;onAuthorize?:()=>void};
const keyOf=(s:GenerationSource)=>`${s.filename}|${s.version}|${s.sha256}`;
export function GenerationResult({state,c,g}:{state:GenerationView;c:ProjectPlanningCopy;g:ProjectGenerationCopy}){
 return <div className="space-y-3"><p role="status" aria-live="polite">{g[state.status as keyof ProjectGenerationCopy]??g.unavailable}</p>{state.proposal&&state.status==='proposal_available'&&<article><h3>{state.proposal.title}</h3><p>{g.proposalSize}: {state.proposal.tasks.length}</p><ul className="space-y-4">{state.proposal.tasks.map(t=><li key={t.id}><h4>{t.id} · {t.title}</h4><p>{g.type}: {t.type} · {t.priority}</p><p>{c.goal}: {t.goal}</p><p className="whitespace-pre-wrap">{t.description}</p><p>{c.dependencies}: {t.dependencyIds.join(', ')}</p><p>{c.criteria}: {t.acceptanceCriteria.join('; ')}</p><p>{c.scope}: {t.scope.join('; ')}</p><p>{g.sources}</p><ul>{t.sourceReferences.map(index=>{const s=state.sources?.[index];return s?<li className="break-all" key={index}>{s.filename} · {s.version} · {s.sha256}</li>:null;})}</ul></li>)}</ul></article>}</div>;
}
export function GenerationOfferView({offer:o,g}:{offer:GenerationOffer;g:ProjectGenerationCopy}){
 const p=o.policy;
 return <div className="space-y-2 break-all text-sm"><p>{g.simulation}</p><ul>{o.sources.map(s=><li key={keyOf(s)}>{s.filename} · {s.version} · {s.sha256}</li>)}</ul><p>{g.preparationHash}: {o.preparationFingerprint}</p><p>{g.offerHash}: {o.offerFingerprint}</p><p>{g.identity}: {[p.identity.providerId,p.identity.providerKind,p.identity.deploymentId,p.identity.providerModelId,p.identity.providerRequestModelId,p.identity.providerModelVersion].join(' / ')}</p><p>{g.destination}: {p.destination}</p><p>{g.ceilings}: {p.maxInputTokens} / {p.maxOutputTokens}</p><p>{g.cost}: {p.maxCostUsdMicros}</p><p>{g.budgets}: {p.dailyTokenBudget} / {p.monthlyCostBudgetUsdCents}</p><p>{g.aggregate}</p></div>;
}
function ExistingOperation({projectId,initialKey='',readAction,c,g}:{projectId:string;initialKey?:string;readAction:GenerationAction;c:ProjectPlanningCopy;g:ProjectGenerationCopy}){
 const[state,read,pending]=useActionState(readAction,{status:'idle'});
 return <form action={read} className="space-y-2"><input name="projectId" type="hidden" value={projectId}/><label>{g.operation}<input className={control} defaultValue={initialKey} name="operationKey" maxLength={35} required pattern="pp-[a-f0-9]{32}"/></label><button className={control} disabled={pending}>{g.read}</button>{pending?<p role="status">{g.submission_pending}</p>:<GenerationResult c={c} g={g} state={state}/>}</form>;
}
export function GenerationAuthorizationForm({offer,operationKey,projectId,generateAction,readAction,c,g,onAuthorize}:{offer:GenerationOffer;operationKey:string;projectId:string;generateAction:GenerationAction;readAction:GenerationAction;c:ProjectPlanningCopy;g:ProjectGenerationCopy;onAuthorize?:()=>void}){
 const[consent,setConsent]=useState(false),[submitted,setSubmitted]=useState(false);
 const[state,generate,pending]=useActionState(generateAction,{status:'awaiting_authorization'});
 return <div className="space-y-3"><GenerationOfferView offer={offer} g={g}/><p className="break-all">{g.operation}: {operationKey}</p><a className="text-accent" href={`/projects/${encodeURIComponent(projectId)}/planning?operationKey=${encodeURIComponent(operationKey)}`}>{g.reload}</a><form action={generate} onSubmit={()=>{setSubmitted(true);onAuthorize?.();const url=new URL(window.location.href);url.searchParams.set("operationKey",operationKey);window.history.replaceState(null,"",url);}} className="space-y-3"><input name="projectId" type="hidden" value={projectId}/><input name="sources" type="hidden" value={JSON.stringify(offer.sources)}/><input name="offerFingerprint" type="hidden" value={offer.offerFingerprint}/><input name="operationKey" type="hidden" value={operationKey}/><label className="block"><input type="checkbox" name="consent" value="true" checked={consent} disabled={pending} onChange={e=>setConsent(e.target.checked)} required/> {g.consent}</label><button className={control} disabled={!consent||pending||submitted}>{g.generate}</button></form>{pending?<p role="status">{g.submission_pending}</p>:<GenerationResult c={c} g={g} state={state}/>}<ExistingOperation key={JSON.stringify([projectId,offer.sources,operationKey])} c={c} g={g} initialKey={operationKey} projectId={projectId} readAction={readAction}/></div>;
}
function Prepare({selected,valid,...p}:Props&{selected:readonly GenerationSource[];valid:boolean}){
 const[state,prepare,pending]=useActionState(p.prepareAction,{status:'idle'});
 return <div><form action={prepare}><input name="projectId" type="hidden" value={p.projectId}/><input name="sources" type="hidden" value={JSON.stringify(selected)}/><button className={control} disabled={!valid||pending||!!state.offer}>{p.g.prepare}</button></form>{pending?<p role="status">{p.g.submission_pending}</p>:<GenerationResult c={p.c} g={p.g} state={state}/>} {state.offer&&state.operationKey&&<GenerationAuthorizationForm key={JSON.stringify([p.projectId,state.offer.sources,state.operationKey,state.offer.offerFingerprint])} {...p} offer={state.offer} operationKey={state.operationKey}/>}</div>;
}
export function ProjectPlanningGenerationForm(p:Props){
 const[selected,setSelected]=useState<string[]>([]),[locked,setLocked]=useState(false);
 const chosen=p.sources.filter(s=>selected.includes(keyOf(s)));
 const valid=chosen.length!==0&&chosen.length<=4&&chosen.length===selected.length&&new Set(chosen.map(s=>s.filename)).size===chosen.length;
 // Selection changes remount the offer/consent. Freeze it after submission to preserve uncertain authority.
 return <div className="space-y-4"><p>{p.g.reviewOnly}</p><p>{p.g.production_binding_unavailable}</p><PlanningMultiSourceSelect c={p.c} sources={p.sources} selected={selected} disabled={locked} onChange={setSelected}/><p>{p.c.aiSelectionHelp}</p><Prepare key={JSON.stringify([p.projectId,chosen])} {...p} onAuthorize={()=>setLocked(true)} selected={chosen} valid={valid}/><p>{p.g.newOperationHelp}</p><ExistingOperation key={JSON.stringify([p.projectId,chosen,p.operationKey])} c={p.c} g={p.g} projectId={p.projectId} initialKey={p.operationKey} readAction={p.readAction}/></div>;
}
