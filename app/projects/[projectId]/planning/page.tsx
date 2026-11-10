import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { OwnerDataUnavailable,SignInRequired } from "@/components/domain/owner-console/owner-state";
import { PlanningSourceForm,PlanningDecisionForm } from "@/components/domain/owner-console/project-planning-forms";
import { loadProjectPlanning } from "@/lib/composition/owner-project-planning.server";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectPlanningCopy } from "@/lib/i18n/project-planning-copy";
import { previewProjectPlanAction,saveProjectPlanAction,decideProjectPlanAction,prepareProjectAIPlanAction } from "./actions";
type Props={params:Promise<{projectId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export default async function ProjectPlanningPage({params,searchParams}:Props){
 const{projectId}=await params,{revision}=await searchParams,{locale}=await getI18n(),c=projectPlanningCopy(locale);
 const view=await loadProjectPlanning(projectId,revision);const selected=view.status==="available"?view.plans.selected:null;
 return <AppShell selectedProject={view.status==="available"?view.binding.project:null}><PageHeader title={c.title} description={c.description}/>
 {view.status==="unauthenticated"&&<SignInRequired/>}{view.status!=="available"&&view.status!=="unauthenticated"&&<OwnerDataUnavailable/>}
 {view.status==="available"&&<div className="space-y-4"><nav className="flex gap-4 text-sm text-accent"><Link href={`/projects/${encodeURIComponent(projectId)}`}>{c.repository}</Link><Link href={`/knowledge?project=${encodeURIComponent(projectId)}`}>{c.knowledge}</Link><Link href={`/tasks?project=${encodeURIComponent(projectId)}`}>{c.tasks}</Link></nav>
 <SectionCard title={c.manual}><p className="mb-3 text-sm text-ink-3">{c.schema}</p>{view.binding.projectStatus==="active"&&view.sources.length>0&&<PlanningSourceForm aiAction={prepareProjectAIPlanAction} c={c} key={projectId} previewAction={previewProjectPlanAction} projectId={projectId} saveAction={saveProjectPlanAction} sources={view.sources}/>}{!view.sources.length&&<p className="text-sm">{c.sourceEmpty}</p>}</SectionCard>
 <SectionCard title={c.history}><nav className="flex gap-3 text-sm text-accent">{view.plans.history.map(r=><Link href={`/projects/${encodeURIComponent(projectId)}/planning?revision=${r.revision}`} key={r.revision}>{c.revision} {r.revision} · {c[r.status as "draft"|"approved"|"rejected"]}</Link>)}</nav>{!view.plans.history.length&&<p className="text-sm">{c.empty}</p>}</SectionCard>
 {selected&&<SectionCard title={`${selected.plan.title} · ${c.revision} ${selected.revision}`}><p className="text-sm">{c.decision}: {c[selected.status]}</p><p className="my-2 break-all text-xs">{selected.source.filename} · {selected.source.version} · {c.sourceHash}: {selected.source.sha256}</p><p className="break-all text-xs">{c.planHash}: {selected.planFingerprint}</p>
 <ul className="my-4 space-y-3 text-sm">{selected.plan.tasks.map(t=><li key={t.id}><strong>{t.id} · {t.title} · {t.priority}</strong><p>{t.goal}</p><p>{t.description}</p><p>{c.criteria}: {t.acceptanceCriteria.join("; ")}</p><p>{c.scope}: {t.scope.join("; ")}</p><p>{c.dependencies}: {t.dependencyIds.join(", ")}</p>{selected.status==="approved"&&<Link className="text-accent" href={`/tasks/${selected.tasks.find(link=>link.sourceId===t.id)!.taskId}?project=${encodeURIComponent(projectId)}`}>{c.task}: {t.id}</Link>}</li>)}</ul>
 {selected.status==="draft"&&view.binding.projectStatus==="active"&&<PlanningDecisionForm action={decideProjectPlanAction} canApprove={selected.revision===view.plans.latestRevision&&!view.plans.history.some(r=>r.status==="approved")} c={c} planFingerprint={selected.planFingerprint} projectId={projectId} revision={selected.revision}/>}<p className="mt-3 text-sm text-ink-3">{c.execution_not_authorized}</p><p className="mt-2 text-sm text-ink-3">{c.activeLocked}</p></SectionCard>}</div>}
 </AppShell>;
}
