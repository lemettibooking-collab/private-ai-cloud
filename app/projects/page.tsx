import Link from "next/link";
import { OwnerDataUnavailable, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadOwnerConsoleOverview } from "@/lib/composition/owner-console-read.server";

// The CURRENT trusted project only. The workspace comes from server configuration; this page
// never selects a tenant. A trusted Project Registry (multi-project) is not connected yet.
export default async function ProjectsPage() {
  const overview = await loadOwnerConsoleOverview();

  return (
    <AppShell>
      <PageHeader
        description="The project bound to this Owner Console by trusted server configuration. Additional projects appear when the trusted Project Registry is connected."
        eyebrow="Projects"
        title="Projects"
      />

      {overview.state === "unauthenticated" && <SignInRequired />}
      {overview.state === "unavailable" && <OwnerDataUnavailable />}

      {overview.state === "available" && (
        <div className="grid gap-4 xl:grid-cols-12">
          <section className="rounded-pac border border-line bg-panel xl:col-span-8">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5">
              <div>
                <p className="pac-label">Current project</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">{overview.project.displayName}</h2>
                <p className="font-mono text-xs text-ink-3">{overview.project.slug}</p>
              </div>
              <StatusBadge tone="success">read available</StatusBadge>
            </div>
            <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
              <div className="px-4 py-3.5">
                <p className="pac-label">Pending approvals</p>
                <p className={`mt-2 font-mono text-2xl ${overview.pendingApprovals > 0 ? "text-warn" : "text-ink"}`}>
                  {overview.pendingApprovals}{overview.queueTruncated ? "+" : ""}
                </p>
              </div>
              <div className="px-4 py-3.5">
                <p className="pac-label">Approval-linked runs</p>
                <p className="mt-2 font-mono text-2xl text-ink">
                  {overview.attentionRuns.length + overview.attentionRunsUnavailable + overview.attentionRunsOmitted}
                </p>
              </div>
            </div>
            <nav className="flex flex-wrap gap-2 px-4 py-3">
              {[
                ["Runs", "/runs"],
                ["Approvals", "/approvals"],
                ["Roadmap", "/roadmap"],
              ].map(([label, href]) => (
                <Link className="inline-flex h-8 items-center rounded-pac border border-line-strong bg-panel-2 px-3 text-[13px] text-ink-2 hover:bg-raised hover:text-ink" href={href} key={href}>
                  {label} →
                </Link>
              ))}
            </nav>
          </section>

          <SectionCard className="xl:col-span-4" title="Project registry">
            <p className="text-[13px] leading-5 text-ink-2">One project is connected.</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">
              Switching between projects requires a trusted Project Registry so that the browser never chooses a
              workspace. It is planned for a later stage.
            </p>
          </SectionCard>
        </div>
      )}
    </AppShell>
  );
}
