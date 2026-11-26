'use client';
import { useActionState } from 'react';
import type { ProjectRoadmapPreview } from '@/lib/planning/project-roadmap-enrollment';
import type { ProjectRoadmapCopy } from '@/lib/i18n/project-roadmap-copy';
export type ProjectRoadmapFormState={status:string;preview?:ProjectRoadmapPreview};
type Action=(previous:ProjectRoadmapFormState,form:FormData)=>Promise<ProjectRoadmapFormState>;
type Selector={projectId:string;revision:number;planFingerprint:string;sourceFingerprint:string};
function Fields({values}:{values:Record<string,string|number>}){return <>{Object.entries(values).map(([name,value])=><input key={name} name={name} value={value} type="hidden"/>)}</>;}
function TaskState({status,c}:{status:string;c:ProjectRoadmapCopy}){
 const labels:Record<string,string>={draft:c.draft,ready:c.taskReady,planning:c.taskPlanning,approved:c.taskApproved,running:c.taskRunning,verifying:c.taskVerifying,waiting_owner:c.taskWaiting,blocked:c.taskBlocked,recovery_required:c.taskRecovery,completed:c.taskCompleted,failed:c.taskFailed,cancelled:c.taskCancelled};
 return <>{labels[status]??c.taskOther}</>;
}
function Message({status,c}:{status:string;c:ProjectRoadmapCopy}){return <p role="status" aria-live="polite">{c[status as keyof ProjectRoadmapCopy]??c.unavailable}</p>;}
function Enrollment({preview:p,action,c}:{preview:ProjectRoadmapPreview;action:Action;c:ProjectRoadmapCopy}){
 const[state,submit,pending]=useActionState(action,{status:'idle'});
 return <div className="space-y-3"><p>{c.milestone}: {p.milestoneId}</p><p>{c.tasks}: {p.tasks.length} · {p.enrolled?c.currentDependencies:c.proposedDependencies}: {p.dependencyCount}</p><p>{c.originalDependencies}: {p.originalDependencyCount}</p><p>{p.enrolled?c.enrolled:c.notEnrolled}</p><ul>{p.tasks.map(t=><li className="break-all text-xs" key={t.taskId}>{t.sourceId} → {t.taskId} · {t.dependencyIds.join(', ')}</li>)}</ul>{!p.enrolled&&<form action={submit}><Fields values={{projectId:p.projectId,revision:p.revision,planFingerprint:p.planFingerprint,sourceFingerprint:p.sourceFingerprint,previewFingerprint:p.previewFingerprint}}/><button className="pac-control px-3 py-2" disabled={pending||state.status==='applied'||state.status==='replayed'}>{c.activate}</button><Message c={c} status={pending?'pending':state.status}/></form>}<a className="text-accent" href={`/roadmap?project=${encodeURIComponent(p.projectId)}`}>{c.open}</a></div>;
}
export function ProjectRoadmapControls({selector,previewAction,enrollAction,c}:{selector:Selector;previewAction:Action;enrollAction:Action;c:ProjectRoadmapCopy}){
 const[state,submit,pending]=useActionState(previewAction,{status:'idle'});
 return <section className="space-y-3"><h3>{c.title}</h3><p>{c.separate}</p><p>{c.policy}</p><form action={submit}><Fields values={selector}/><button className="pac-control px-3 py-2" disabled={pending}>{c.preview}</button></form>{state.status==='preview'&&state.preview?<Enrollment key={state.preview.previewFingerprint} preview={state.preview} c={c} action={enrollAction}/>:<Message c={c} status={pending?'pending':state.status}/>}</section>;
}
export function ProjectRoadmapTaskControls({preview:p,taskId,action,c,reviewedPlan}:{preview:ProjectRoadmapPreview;taskId:string;action:Action;c:ProjectRoadmapCopy;reviewedPlan:{planId:string;revision:number;fingerprint:string}|null}){
 const[state,submit,pending]=useActionState(action,{status:'idle'}),task=p.tasks.find(t=>t.taskId===taskId);if(!task)return null;
 const exactPlan=task.featurePlan&&reviewedPlan&&task.featurePlan.planId===reviewedPlan.planId&&task.featurePlan.revision===reviewedPlan.revision&&task.featurePlan.fingerprint===reviewedPlan.fingerprint;
 return <section className="space-y-3"><h3>{c.provenance}</h3><p className="break-all text-xs">{p.projectId} · {p.revision} · {p.planFingerprint} · {p.sourceFingerprint}</p><p>{p.enrolled?c.enrolled:c.notEnrolled} · {c.milestone}: {p.milestoneId}</p><p><TaskState status={task.status} c={c}/></p><p>{p.enrolled?c.dependencyStatus:c.proposedDependencyStatus}</p><ul>{task.dependencies.map(d=><li className="break-all text-xs" key={d.taskId}>{d.taskId} · <TaskState status={d.status} c={c}/></li>)}</ul><p>{c.separate}</p>{p.enrolled&&task.status==='draft'&&(task.featurePlan&&exactPlan?<form action={submit}><Fields values={{projectId:p.projectId,revision:p.revision,planFingerprint:p.planFingerprint,sourceFingerprint:p.sourceFingerprint,previewFingerprint:p.previewFingerprint,taskId,expectedVersion:task.version,featurePlanId:task.featurePlan.planId,featurePlanRevision:task.featurePlan.revision,featurePlanFingerprint:task.featurePlan.fingerprint}}/><button className="pac-control px-3 py-2" disabled={pending||state.status==='applied'||state.status==='replayed'}>{c.ready}</button></form>:<p>{task.featurePlan?c.conflict:c.noPlan}</p>)}<Message c={c} status={pending?'pending':state.status}/><a className="text-accent" href={`/roadmap?project=${encodeURIComponent(p.projectId)}`}>{c.open}</a></section>;
}
