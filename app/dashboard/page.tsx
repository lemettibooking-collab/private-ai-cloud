import Link from "next/link";
import { ApprovalCard } from "@/components/domain/approval-card";
import { AuditTimeline } from "@/components/domain/audit-timeline";
import { AppShell } from "@/components/shell/app-shell";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  activityStats,
  approvals,
  auditEvents,
  departments,
  quickActions,
  roadmapItems,
  weeklyOwnerReportSummary,
  workflowRuns,
} from "@/lib/mock-data";
import type { StatusTone } from "@/types/app";
import type { WorkflowRun } from "@/types/workflow";

export default function DashboardPage() {
  return (
    <AppShell>
      <PageHeader
        description="Owner attention center for approvals, workflow activity, AI outputs, system health, and weekly reporting."
        eyebrow="Owner dashboard"
        title="Smart Algorithms Demo operations"
      />

      <SectionCard
        description="Owner-first shortcuts for the MVP Smart Algorithms AI Operations Center."
        title="Quick actions"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => (
            <Link
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition hover:border-cyan-400/30 hover:bg-slate-900"
              href={action.href}
              key={action.title}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-100">
                  {action.title}
                </p>
                <StatusBadge tone={action.tone}>open</StatusBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {action.description}
              </p>
            </Link>
          ))}
        </div>
      </SectionCard>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {activityStats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <SectionCard
          description="Decisions that should happen before the system does anything outside the prototype."
          title="Owner attention center"
        >
          <div className="space-y-3">
            {[
              ["Approve or reject Telegram publication", "high risk"],
              ["Retry failed SEO Strategy indexing", "knowledge gap"],
              ["Review Codex task before launch", "approval gate"],
              ["Keep local runner and integrations locked", "system policy"],
            ].map(([title, label]) => (
              <div
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                key={title}
              >
                <p className="text-sm text-slate-200">{title}</p>
                <StatusBadge tone="warning">{label}</StatusBadge>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          description="High-priority items that need human review before any external action."
          title="Pending Approvals"
        >
          <div className="space-y-4">
            {approvals.slice(0, 2).map((approval) => (
              <ApprovalCard approval={approval} key={approval.id} />
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <SectionCard title="Activity Summary">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["MVP workflows", "5 active"],
              ["AI Departments", `${departments.length} visible`],
              ["External actions", "locked"],
            ].map(([label, value]) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                key={label}
              >
                <p className="text-xs font-medium uppercase text-slate-500">
                  {label}
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-50">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          description="Current operating posture for the prototype."
          title="System Health"
        >
          <div className="space-y-3">
            {(
              [
                ["Knowledge indexing", "1 failed document", "danger"],
                ["External integrations", "Locked by default", "locked"],
                ["Workflow worker", "Mocked / not connected", "neutral"],
                ["Approval policy", "Manual review required", "success"],
              ] satisfies Array<[string, string, StatusTone]>
            ).map(([label, value, tone]) => (
              <div
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                key={label}
              >
                <span className="text-sm text-slate-300">{label}</span>
                <StatusBadge tone={tone}>{value}</StatusBadge>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard
          description="Recent generated outputs and run states."
          title="Recent Workflow Runs"
        >
          <DataTable<WorkflowRun>
            columns={[
              { key: "title", header: "Run" },
              {
                key: "status",
                header: "Status",
                render: (row) => (
                  <StatusBadge tone={row.statusTone}>{row.status}</StatusBadge>
                ),
              },
              { key: "requestedBy", header: "Owner" },
              { key: "updatedAt", header: "Updated" },
            ]}
            getRowKey={(row) => row.id}
            rows={workflowRuns}
          />
        </SectionCard>

        <SectionCard
          description="Generated AI artifacts that may require review."
          title="Recent AI Outputs"
        >
          <div className="space-y-3">
            {workflowRuns.map((run) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                key={run.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-100">
                    {run.title}
                  </p>
                  <StatusBadge tone={run.statusTone}>{run.status}</StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {run.outputPreview}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard title="Risk / Attention Items">
          <AuditTimeline events={auditEvents} />
        </SectionCard>

        <SectionCard
          description="Latest owner-facing summary generated from mocked operational data."
          title={weeklyOwnerReportSummary.title}
        >
          <p className="text-sm leading-6 text-slate-300">
            {weeklyOwnerReportSummary.subtitle}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {weeklyOwnerReportSummary.metrics.map((metric) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                key={metric.label}
              >
                <p className="text-xs font-medium uppercase text-slate-500">
                  {metric.label}
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-50">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          action={<StatusBadge tone="success">current: v0.1</StatusBadge>}
          description="The prototype is intentionally scoped to the first Smart Algorithms internal demo."
          title="Roadmap focus"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-50">
                {roadmapItems[0].title}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {roadmapItems[0].description}
              </p>
            </div>
            <Link
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
              href="/roadmap"
            >
              Open Roadmap
            </Link>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
