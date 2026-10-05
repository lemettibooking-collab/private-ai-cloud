import Link from "next/link";
import { formatCount, formatTimestamp, formatUsdMicros, humanize } from "@/components/domain/owner-console/format";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { ApprovalStatusBadge, RiskBadge, RunStatusBadge } from "@/components/domain/owner-console/run-status";
import { approvalTone } from "@/components/domain/owner-console/status-tone";
import { AppShell } from "@/components/shell/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadOwnerRun } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type RunDetailPageProps = {
  // The route carries ONLY the runId as runtime target; workspace and identity come from trusted
  // server state. The optional `project` selector never authorizes access: under a selected project,
  // a run of another project is shown as the same opaque "unavailable" as a missing run.
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function Field({ label, children, mono = true }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <dt className="pac-label !text-[9.5px]">{label}</dt>
      <dd className={`mt-1 truncate text-[12.5px] text-ink ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function StepList({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <span className="rounded-[4px] border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2" key={id}>{id}</span>
      ))}
    </span>
  );
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-mono text-[12.5px] text-ink">{value}</dd>
    </div>
  );
}

export default async function RunDetailPage({ params, searchParams }: RunDetailPageProps) {
  const { runId } = await params;
  const view = await loadOwnerRun(runId, (await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;
  const runsHref = projectScopedHref("/runs", selected?.projectId ?? null);

  return (
    <AppShell selectedProject={selected}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="pac-label">
            <Link className="!text-accent hover:underline" href={runsHref}>Runs</Link> / Run detail
          </p>
          <h1 className="mt-1 truncate font-mono text-[18px] font-medium leading-7 text-ink">
            {view.state === "available" && view.run.state === "available" ? view.run.detail.run.runId : "Run"}
          </h1>
          {view.state === "available" && view.run.state === "available" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <RunStatusBadge status={view.run.detail.run.status} />
              <span className="text-[12px] text-ink-3">Execution attempt</span>
              <span className="text-ink-3">·</span>
              <span className="font-mono text-[11.5px] text-ink-2">{view.run.detail.run.projectId}</span>
              <span className="text-ink-3">·</span>
              <span className="font-mono text-[11.5px] text-ink-2">{view.run.detail.run.workflowId}</span>
            </div>
          )}
        </div>
        {view.state === "available" && <ScopeBadge project={selected} />}
      </div>

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/runs" />}

      {view.state === "available" && view.run.state === "unavailable" && (
        <div className="pac-surface px-6 py-9 text-center">
          <p className="pac-label">Run</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">Run unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-5 text-ink-3">
            {selected ? "This run cannot be shown in this project context." : "This run cannot be shown."}
          </p>
          <Link className="pac-control mt-5 inline-flex h-8 items-center px-3 text-[13px] text-ink-2" href={runsHref}>
            Back to runs
          </Link>
        </div>
      )}

      {view.state === "available" && view.run.state === "available" && (() => {
        const { run, usage, latestModelInvocation, audit } = view.run.detail;
        return (
          <>
            <dl className="pac-surface grid grid-cols-2 divide-line overflow-hidden md:grid-cols-3 xl:grid-cols-6 xl:divide-x">
              <Field label="Project ID">{run.projectId}</Field>
              <Field label="Workflow ID">{run.workflowId}</Field>
              <Field label="Revision">{run.revision}</Field>
              <Field label="Created">{formatTimestamp(run.createdAt)}</Field>
              <Field label="Started">{formatTimestamp(run.startedAt)}</Field>
              <Field label="Completed">{formatTimestamp(run.completedAt)}</Field>
            </dl>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <div className="flex flex-col gap-4 xl:col-span-8">
                <SectionCard title="Steps">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="pac-label">Current steps</p>
                      <div className="mt-2"><StepList ids={run.currentStepIds} /></div>
                    </div>
                    <div>
                      <p className="pac-label">Ready steps</p>
                      <div className="mt-2"><StepList ids={run.readyStepIds} /></div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard description="Read-only. Decisions require the future write boundary." title="Approval" tone={run.approval ? approvalTone[run.approval.status] : undefined}>
                  {run.approval ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <ApprovalStatusBadge status={run.approval.status} />
                      <RiskBadge risk={run.approval.riskLevel} />
                      <span className="text-[13px] text-ink">{humanize(run.approval.requestedCapability)}</span>
                      <span className="font-mono text-[11px] text-ink-3">step {run.approval.stepId}</span>
                    </div>
                  ) : (
                    <p className="text-[13px] text-ink-3">No approval is attached to this run.</p>
                  )}
                </SectionCard>

                <SectionCard
                  count={audit.state === "available" ? audit.items.length : undefined}
                  description={audit.state === "available" ? `Latest ${audit.limit} events at most` : undefined}
                  title="Audit timeline"
                >
                  {audit.state === "unavailable" ? (
                    <p className="text-[13px] text-ink-3">Audit timeline unavailable.</p>
                  ) : audit.items.length === 0 ? (
                    <p className="text-[13px] text-ink-3">No audit events recorded for this run.</p>
                  ) : (
                    <ol className="relative ml-1.5 border-l border-line">
                      {audit.items.map((item, index) => (
                        <li className="relative pb-3 pl-4 last:pb-0" key={`${item.createdAt}-${index}`}>
                          <span aria-hidden className="absolute -left-[3.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-line-strong" />
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <span className="font-mono text-xs text-ink">{item.eventType}</span>
                            <span className="pac-label">{item.actorKind}</span>
                            <span className="font-mono text-[11px] text-ink-3">{formatTimestamp(item.createdAt)}</span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </SectionCard>
              </div>

              <div className="flex flex-col gap-4 xl:col-span-4">
                <SectionCard title="Usage & cost">
                  <p className="font-mono text-[26px] font-medium leading-none text-ink">{formatUsdMicros(usage.totalCostUsdMicros)}</p>
                  <p className="mt-1.5 text-[11.5px] text-ink-3">Recorded provider cost for this run</p>
                  <dl className="mt-3 divide-y divide-line border-t border-line">
                    <UsageRow label="Total tokens" value={formatCount(usage.totalTokens)} />
                    <UsageRow label="Input / output" value={`${formatCount(usage.inputTokens)} / ${formatCount(usage.outputTokens)}`} />
                    <UsageRow label="Invocations" value={formatCount(usage.invocationCount)} />
                    <UsageRow label="Succeeded / failed" value={`${usage.succeededCount} / ${usage.failedCount}`} />
                    <UsageRow label="Outcome unknown" value={String(usage.ambiguousCount)} />
                  </dl>
                  {usage.ambiguousCount > 0 && (
                    <p className="mt-2"><StatusBadge tone="warning">ambiguous outcome held</StatusBadge></p>
                  )}
                </SectionCard>

                <SectionCard title="Latest model invocation">
                  {latestModelInvocation ? (
                    <dl className="-my-2 divide-y divide-line">
                      <UsageRow label="Status" value={latestModelInvocation.status.replaceAll("_", " ")} />
                      <UsageRow label="Step / attempt" value={`${latestModelInvocation.stepId} · #${latestModelInvocation.attemptNumber}`} />
                      <UsageRow label="Provider" value={latestModelInvocation.providerId} />
                      <UsageRow label="Model" value={latestModelInvocation.providerModelId} />
                      <UsageRow label="Version" value={latestModelInvocation.providerModelVersion} />
                      <UsageRow label="Started" value={formatTimestamp(latestModelInvocation.createdAt)} />
                      <UsageRow label="Completed" value={formatTimestamp(latestModelInvocation.completedAt)} />
                    </dl>
                  ) : (
                    <p className="text-[13px] text-ink-3">No model invocation recorded.</p>
                  )}
                </SectionCard>
              </div>
            </div>
          </>
        );
      })()}
    </AppShell>
  );
}
