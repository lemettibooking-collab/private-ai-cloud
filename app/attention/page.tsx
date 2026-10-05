import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { AttentionTaskList } from "@/components/domain/owner-console/attention-task-list";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { observedCount } from "@/components/domain/owner-console/bounded-count";
import { attentionGroups } from "@/components/domain/owner-console/status-tone";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Instrument, InstrumentStrip } from "@/components/ui/instrument";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerAttention } from "@/lib/composition/owner-console-read.server";

type AttentionPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// My Attention: Owner decisions, blockers and interventions. Tasks waiting on the Owner, blocked,
// needing recovery or failed — grouped by severity — plus pending approvals. A selected project
// narrows both factually. Read-only.
export default async function AttentionPage({ searchParams }: AttentionPageProps) {
  const view = await loadOwnerAttention((await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description="Decisions, blockers and interventions: tasks waiting on you, blocked, needing recovery or failed — and pending approvals. Read-only."
        eyebrow="My Attention"
        title={selected ? `${selected.displayName} — my attention` : "My attention"}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/attention" />}

      {view.state === "available" && (() => {
        const names = new Map(view.projects.map((project) => [project.projectId, project.displayName]));
        const approvals = view.mode === "all" ? view.approvals : view.projectApprovals.approvals;
        const pending = view.mode === "all" ? view.pendingApprovals : view.projectApprovals.pendingApprovals;
        const highRisk = view.mode === "all" ? view.highRiskApprovals : view.projectApprovals.highRiskApprovals;
        // Severity groups show OBSERVED counts within the loaded attention tasks; only the attention
        // total carries "+" when the bounded view is full (see the footnote).
        const within = view.attentionTasks.truncated ? " · within shown tasks (bounded view)" : "";
        const groups = attentionGroups.map((group) => ({
          ...group,
          tasks: view.attentionTasks.tasks.filter((task) => (group.statuses as readonly string[]).includes(task.status)),
        }));
        return (
          <>
            <InstrumentStrip label="Attention summary">
              {groups.map((group) => (
                <Instrument
                  detail={`${group.id === "waiting_owner" ? "Needs an Owner response" : group.id === "blocked" ? "Cannot proceed without intervention" : "Ended with status failed"}${within}`}
                  key={group.id}
                  label={group.label}
                  state={group.tasks.length > 0 ? (group.tone === "danger" ? "intervene" : "action") : undefined}
                  tone={group.tasks.length > 0 ? group.tone : "neutral"}
                  value={observedCount(group.tasks.length)}
                />
              ))}
              <Instrument
                detail={selected ? "Runtime approvals · this project" : "Runtime approvals · workspace-wide"}
                label="Pending approvals"
                state={pending > 0 ? "decide" : undefined}
                tone={pending > 0 ? "attention" : "neutral"}
                value={pending}
              />
              <Instrument
                detail="High or critical pending approvals"
                label="High / critical"
                state={highRisk > 0 ? "risk" : undefined}
                tone={highRisk > 0 ? "danger" : "neutral"}
                value={highRisk}
              />
            </InstrumentStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
                {view.attentionTasks.tasks.length === 0 ? (
                  <SectionCard count={0} flush title="Tasks needing attention">
                    <EmptyState description="No task is waiting on you, blocked, in recovery or failed in this scope." title="No task needs attention" variant="inline" />
                  </SectionCard>
                ) : (
                  groups.filter((group) => group.tasks.length > 0).map((group) => (
                    <SectionCard count={observedCount(group.tasks.length)} flush key={group.id} title={group.label} tone={group.tone}>
                      <AttentionTaskList projectNames={names} selectedProjectId={selected?.projectId ?? null} showProject={!selected} tasks={group.tasks} />
                    </SectionCard>
                  ))
                )}
                {view.attentionTasks.truncated && (
                  <p className="text-[11px] text-ink-3">
                    Bounded view: the {view.attentionTasks.tasks.length} most recently updated attention tasks are shown and more may exist; group counts cover the shown tasks only.
                  </p>
                )}
              </div>

              <SectionCard
                className="xl:col-span-5"
                count={approvals.length}
                description={selected ? "Pending approvals whose run belongs to this project, highest risk first." : "Pending approvals across all projects, highest risk first."}
                flush
                title="Pending approvals"
                tone="attention"
              >
                {approvals.length === 0 ? (
                  <EmptyState description="No pending runtime approval in this scope." title="Approval queue is clear" variant="inline" />
                ) : (
                  <ApprovalQueue approvals={approvals} compact selectedProjectId={selected?.projectId ?? null} />
                )}
                {view.mode === "project" && view.projectApprovals.unresolvedApprovals > 0 && (
                  <p className="border-t border-line bg-warn/5 px-4 py-2 text-xs text-ink-3">
                    {view.projectApprovals.unresolvedApprovals} workspace approval(s) could not be attributed to a project. See{" "}
                    <Link className="text-accent hover:underline" href="/attention">All Projects</Link>.
                  </p>
                )}
              </SectionCard>
            </div>
          </>
        );
      })()}
    </AppShell>
  );
}
