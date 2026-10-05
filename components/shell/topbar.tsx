import Link from "next/link";
import { BellIcon, PlusIcon } from "@/components/shell/icons";
import { ProjectSwitcher, type SwitcherProject } from "@/components/shell/project-switcher";
import { quickCreateHref } from "@/lib/projects/project-context";
import type { OwnerConsoleProject, OwnerConsoleShell } from "@/lib/composition/owner-console-read.server";

type TopbarProps = {
  shell: OwnerConsoleShell;
  selectedProject: OwnerConsoleProject | null;
};

const switcherProject = (project: OwnerConsoleProject): SwitcherProject =>
  ({ projectId: project.projectId, displayName: project.displayName, status: project.status });

// Control-plane top bar: workspace (global) context → project context → Owner-critical indicators
// (workspace-global approvals) → + New Task → session. Every value comes from the shell read.
export function Topbar({ shell, selectedProject }: TopbarProps) {
  const summary = shell;
  const pending = summary.state === "available" ? summary.pendingApprovals : null;
  const highRisk = summary.state === "available" ? summary.highRiskApprovals : 0;

  return (
    <header className="pac-shell sticky top-0 z-20 flex h-12 shrink-0 items-center border-b border-line">
      <Link className="flex h-full w-56 shrink-0 items-center gap-2.5 border-r border-line px-4" href="/dashboard">
        <span className="pac-control-accent flex h-6 w-6 items-center justify-center !rounded-[6px] font-mono text-[9.5px] font-semibold">
          PAC
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[12.5px] font-semibold tracking-tight text-ink">Private AI Cloud</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Owner console</span>
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        {summary.state === "available" && (
          <div className="hidden min-w-0 flex-col leading-tight lg:flex" title="Workspace (trusted server configuration)">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Workspace</span>
            <span className="truncate text-[12.5px] text-ink-2">{summary.workspace.displayName}</span>
          </div>
        )}
        {summary.state === "available" && <span aria-hidden className="hidden h-6 w-px bg-line lg:block" />}

        <ProjectSwitcher
          available={summary.state === "available" && summary.projectsAvailable}
          projects={summary.state === "available" ? summary.projects.map(switcherProject) : []}
          selected={selectedProject ? switcherProject(selectedProject) : null}
          truncated={summary.state === "available" && summary.projectsTruncated}
        />

        <div className="ml-auto flex items-center gap-2">
          <Link
            aria-label={pending === null ? "Approvals" : `${pending} pending approvals across all projects, ${highRisk} high or critical risk`}
            className={`pac-control flex h-8 items-center gap-2 px-2.5 font-mono text-xs ${
              pending && pending > 0 ? "!border-warn/35 !bg-warn/10 text-warn hover:!bg-warn/15" : "text-ink-2"
            }`}
            href="/approvals"
            title="Pending approvals — all projects (workspace-wide), regardless of the selected project"
          >
            <BellIcon className="h-3.5 w-3.5" />
            <span>{pending === null ? "—" : pending}</span>
            <span className="hidden font-sans text-[10px] uppercase tracking-[0.1em] opacity-70 xl:inline">pending · all</span>
            {highRisk > 0 && (
              <span className="rounded-[4px] border border-bad/35 bg-bad/12 px-1 text-[10px] text-bad shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">{highRisk} high</span>
            )}
          </Link>

          {summary.state === "available" ? (
            // AI-038.4b Quick Create: opens the form (project-scoped when a project is selected). The page
            // and its Server Action re-check Owner authority and the project; this link grants nothing.
            <Link
              className="pac-control-accent flex h-8 items-center gap-1.5 px-3 text-xs font-medium"
              href={quickCreateHref(selectedProject?.projectId ?? null)}
              title={selectedProject ? `Create a draft task in ${selectedProject.displayName}` : "Create a draft task in an active project"}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New Task
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="pac-control flex h-8 cursor-not-allowed items-center gap-1.5 px-3 text-xs text-ink-3 opacity-60"
              title="Quick Create needs an authenticated PAC Owner."
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New Task
            </span>
          )}

          <span aria-hidden className="mx-1 h-6 w-px bg-line" />

          {summary.state === "available" && (
            <div className="pac-control flex h-8 items-center gap-2 pl-2.5 pr-1">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                Owner
              </span>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
              <a className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-panel-2 hover:text-ink" href="/api/auth/signout">
                Sign out
              </a>
            </div>
          )}
          {summary.state === "unauthenticated" && (
            <>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
              <a className="pac-control-accent flex h-8 items-center px-2.5 text-xs" href="/api/auth/signin">
                Sign in
              </a>
            </>
          )}
          {(summary.state === "unavailable" || summary.state === "project_unavailable") && (
            <span className="flex h-8 items-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              Owner · unavailable
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
