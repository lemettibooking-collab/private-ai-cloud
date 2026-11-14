import Link from "next/link";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerRoadmapView, OwnerRoadmapTask } from "@/lib/composition/owner-roadmap-read.server";
import { messages } from "@/lib/i18n/messages";
import { roadmapContent } from "@/lib/i18n/roadmap-content";
import type { Locale } from "@/lib/i18n/locale";
export function RoadmapOwnerView({ view, locale }: { view: Extract<OwnerRoadmapView, { state: "available" }>; locale: Locale }) {
  const c = roadmapContent[locale], taskLabels = messages[locale].taskStatus;
  const purposes: Record<string, string> = { feature_plan_approval: c.planApproval, scope_change: c.scopeChange, budget_or_risk_increase: c.budgetRisk, architecture_change: c.architecture, result_acceptance: c.result };
  const categories = [
    [c.current, view.tasks.filter(t => ["planning", "approved", "running", "verifying"].includes(t.status))],
    [c.next, view.tasks.filter(t => t.ready)],
    [c.blocked, view.tasks.filter(t => ["blocked", "failed"].includes(t.status) || t.status === "ready" && !t.ready)],
    [c.recovery, view.tasks.filter(t => t.status === "recovery_required")],
    [c.owner, view.tasks.filter(t => t.status === "waiting_owner" || t.pendingOwnerPurposes.length > 0)],
  ] as const;
  const taskHref = (task: OwnerRoadmapTask) => `/tasks/${encodeURIComponent(task.taskId)}?project=${encodeURIComponent(task.projectId)}`;
  return <>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {categories.map(([title, tasks]) => <SectionCard key={title} title={title} count={tasks.length}>
        {tasks.length ? <ul className="space-y-2 text-[12px] text-ink-2">{tasks.slice(0, 4).map(t => <li key={t.taskId}><Link href={taskHref(t)} className="hover:text-accent">{t.title}</Link></li>)}</ul> : <p className="text-[12px] text-ink-3">{c.none}</p>}
      </SectionCard>)}
    </div>
    {view.truncated && <p className="mt-3 text-[11px] text-warn">{c.bounded}</p>}
    <SectionCard className="mt-4" title={c.milestones} count={view.milestones.length}>
      {view.milestones.length ? <div className="grid gap-3 md:grid-cols-2">{view.milestones.map(m => <div key={`${m.projectId}/${m.milestoneId}`} className="rounded-lg border border-line p-3">
        <p className="text-[13px] font-medium text-ink">{m.title}</p><p className="mt-1 text-[11px] text-ink-3">{m.projectId} · {c[m.status]} · {c.completed}: {m.completedTasks}/{m.totalTasks}</p>
      </div>)}</div> : <p className="text-[12px] text-ink-3">{c.empty}</p>}
    </SectionCard>
    <SectionCard className="mt-4" title={c.tasks} count={view.tasks.length}>
      {!view.tasks.length && <p className="text-[12px] text-ink-3">{c.empty}</p>}
      <div className="space-y-4">{view.tasks.map(task => <article key={task.taskId} className="rounded-lg border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link className="text-[13px] font-semibold text-ink hover:text-accent" href={taskHref(task)}>{task.title}</Link>
          <StatusBadge tone={task.status === "completed" ? "success" : task.status === "blocked" || task.status === "failed" || task.status === "recovery_required" ? "danger" : task.status === "waiting_owner" ? "warning" : "neutral"}>{taskLabels[task.status]}</StatusBadge>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">{task.projectId} · {c.progress}: {task.completedNodes}/{task.totalNodes} · {c.held}: {(task.heldExposureUsdMicros / 1000000).toFixed(6)}</p>
        <p className="mt-1 text-[11px] text-ink-3">{c.controllerRevision}: {task.controllerRevision} · {taskLabels[task.status]}</p>
        {!!task.pendingOwnerPurposes.length && <p className="mt-2 text-[12px] text-warn">{c.owner}: {task.pendingOwnerPurposes.map(p => purposes[p]).join(" · ")}</p>}
        {!!task.nodes.length && <div className="mt-3 space-y-2" aria-label={c.nodes}>{task.nodes.map(node => <div key={node.developmentTaskId} className="rounded border border-line/70 px-3 py-2 text-[11px] text-ink-2">
          <p className="font-mono">{node.developmentTaskId} · {c.attempt}: {node.attemptNumber} · {c.nodeStatus[node.status as keyof typeof c.nodeStatus]}</p>
          <p className="mt-1">{c.route}: {node.selectedExecutor ?? c.noRoute}</p>
          <p className="mt-1">{c.quality}: {c[node.quality]} · {c.security}: {c[node.security]}</p>
        </div>)}</div>}
      </article>)}</div>
    </SectionCard>
    <p className="mt-3 text-[11px] text-ink-3">{c.footnote}</p>
  </>;
}
