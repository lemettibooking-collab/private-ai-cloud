import Link from "next/link";
import { BellIcon, PlusIcon } from "@/components/shell/icons";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { ProjectSwitcher, type SwitcherProject } from "@/components/shell/project-switcher";
import { format, type Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { quickCreateHref } from "@/lib/projects/project-context";
import type { OwnerConsoleProject, OwnerConsoleShell } from "@/lib/composition/owner-console-read.server";

type TopbarProps = {
  shell: OwnerConsoleShell;
  selectedProject: OwnerConsoleProject | null;
  locale: Locale;
  t: Messages;
};

const switcherProject = (project: OwnerConsoleProject): SwitcherProject =>
  ({ projectId: project.projectId, displayName: project.displayName, status: project.status });

// Control-plane top bar: workspace (global) context → project context → Owner-critical indicators
// (workspace-global approvals) → + New Task → interface language → session. Every value comes from
// the shell read; the language selector is a presentation preference only.
export function Topbar({ shell, selectedProject, locale, t }: TopbarProps) {
  const summary = shell;
  const pending = summary.state === "available" ? summary.pendingApprovals : null;
  const highRisk = summary.state === "available" ? summary.highRiskApprovals : 0;

  return (
    <header className="pac-shell sticky top-0 z-20 flex h-12 shrink-0 items-center border-b border-line">
      <Link className="flex h-full w-56 shrink-0 items-center gap-2.5 border-r border-line px-4" href="/dashboard">
        <span className="pac-control-accent flex h-6 w-6 items-center justify-center !rounded-[6px] font-mono text-[9.5px] font-semibold">
          PAC
        </span>
        <span className="whitespace-nowrap text-[12.5px] font-semibold tracking-tight text-ink">Private AI Cloud</span>
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        {summary.state === "available" && (
          <div className="hidden min-w-0 flex-col leading-tight lg:flex" title={t.topbar.workspaceTitle}>
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-3">{t.topbar.workspace}</span>
            <span className="truncate text-[12.5px] text-ink-2">{summary.workspace.displayName}</span>
          </div>
        )}
        {summary.state === "available" && <span aria-hidden className="hidden h-6 w-px bg-line lg:block" />}

        <ProjectSwitcher
          available={summary.state === "available" && summary.projectsAvailable}
          labels={{
            ...t.projectSwitcher,
            allProjects: t.common.allProjects,
            current: t.common.current,
            status: t.projectStatus,
          }}
          projects={summary.state === "available" ? summary.projects.map(switcherProject) : []}
          selected={selectedProject ? switcherProject(selectedProject) : null}
          truncated={summary.state === "available" && summary.projectsTruncated}
        />

        <div className="ml-auto flex items-center gap-2">
          <Link
            aria-label={pending === null ? t.topbar.approvalsAria : format(t.topbar.approvalsAriaCount, { pending, high: highRisk })}
            className={`pac-control flex h-8 items-center gap-2 px-2.5 text-xs ${
              pending && pending > 0 ? "!border-warn/35 !bg-warn/10 text-warn hover:!bg-warn/15" : "text-ink-2"
            }`}
            href="/approvals"
            title={t.topbar.approvalsTitle}
          >
            <BellIcon className="h-3.5 w-3.5" />
            <span className="font-mono">{pending === null ? "—" : pending}</span>
            <span className="hidden text-[11.5px] opacity-80 xl:inline">{t.topbar.pendingAll}</span>
            {highRisk > 0 && (
              <span className="rounded-[4px] border border-bad/35 bg-bad/12 px-1 text-[11px] text-bad shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">{format(t.topbar.highCount, { count: highRisk })}</span>
            )}
          </Link>

          {summary.state === "available" ? (
            // AI-038.4b Quick Create: opens the form (project-scoped when a project is selected). The page
            // and its Server Action re-check Owner authority and the project; this link grants nothing.
            <Link
              className="pac-control-accent flex h-8 items-center gap-1.5 px-3 text-xs font-medium"
              href={quickCreateHref(selectedProject?.projectId ?? null)}
              title={selectedProject ? format(t.topbar.newTaskInProject, { project: selectedProject.displayName }) : t.topbar.newTaskAnyProject}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">{t.topbar.newTask}</span>
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="pac-control flex h-8 cursor-not-allowed items-center gap-1.5 px-3 text-xs text-ink-3 opacity-60"
              title={t.topbar.newTaskNeedsOwner}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">{t.topbar.newTask}</span>
            </span>
          )}

          <LocaleSwitcher ariaLabel={t.locale.ariaLabel} locale={locale} menuLabel={t.locale.menuLabel} />

          <span aria-hidden className="mx-1 h-6 w-px bg-line" />

          {summary.state === "available" && (
            <div className="pac-control flex h-8 items-center gap-2 pl-2.5 pr-1">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                {t.topbar.owner}
              </span>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
              <a className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-panel-2 hover:text-ink" href="/api/auth/signout">
                {t.topbar.signOut}
              </a>
            </div>
          )}
          {summary.state === "unauthenticated" && (
            <>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
              <a className="pac-control-accent flex h-8 items-center px-2.5 text-xs" href="/api/auth/signin">
                {t.topbar.signIn}
              </a>
            </>
          )}
          {(summary.state === "unavailable" || summary.state === "project_unavailable") && (
            <span className="flex h-8 items-center text-[12px] text-ink-3">
              {t.topbar.ownerUnavailable}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
