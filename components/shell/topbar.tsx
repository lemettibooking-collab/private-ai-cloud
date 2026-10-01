import Link from "next/link";
import { ProjectSwitcher } from "@/components/shell/project-switcher";
import type { OwnerConsoleAttentionSummary } from "@/lib/composition/owner-console-read.server";

type TopbarProps = {
  summary: OwnerConsoleAttentionSummary;
};

function BellIcon() {
  return (
    <svg aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <path d="M4 6.5a4 4 0 0 1 8 0v3l1.2 2H2.8L4 9.5z" strokeLinejoin="round" />
      <path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
    </svg>
  );
}

export function Topbar({ summary }: TopbarProps) {
  const available = summary.state === "available";
  const pending = available ? summary.pendingApprovals : null;

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur">
      <Link className="flex w-[11.5rem] shrink-0 items-center gap-2" href="/dashboard">
        <span className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-accent/40 bg-accent/10 font-mono text-[10px] font-semibold text-accent">
          PAC
        </span>
        <span className="hidden text-[13px] font-semibold tracking-tight text-ink lg:inline">Private AI Cloud</span>
      </Link>

      <ProjectSwitcher project={summary.project} />

      <div
        aria-disabled="true"
        className="ml-2 hidden h-8 w-72 cursor-default items-center justify-between rounded-pac border border-line bg-panel px-2.5 text-xs text-ink-3 lg:flex"
        title="Command palette — not available yet"
      >
        <span>Search / command — not available yet</span>
        <kbd className="rounded-[3px] border border-line px-1 font-mono text-[10px]">⌘K</kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-pac border border-line bg-panel px-2.5 text-xs text-ink-3"
          disabled
          title="Task creation is not available yet (no write boundary)"
          type="button"
        >
          + New Task <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]">· soon</span>
        </button>

        <Link
          aria-label={pending === null ? "Approvals" : `${pending} pending approvals`}
          className={`flex h-8 items-center gap-1.5 rounded-pac border px-2.5 font-mono text-xs ${
            pending && pending > 0 ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-panel text-ink-2"
          }`}
          href="/approvals"
          title="Pending approvals"
        >
          <BellIcon />
          {pending === null ? "—" : pending}
        </Link>

        {summary.state === "available" && (
          <div className="flex h-8 items-center gap-2 rounded-pac border border-line bg-panel pl-2.5 pr-1">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-2">Owner</span>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
            <a className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-panel-2 hover:text-ink" href="/api/auth/signout">
              Sign out
            </a>
          </div>
        )}
        {summary.state === "unauthenticated" && (
          <>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
            <a className="flex h-8 items-center rounded-pac border border-accent/40 bg-accent/10 px-2.5 text-xs text-accent" href="/api/auth/signin">
              Sign in
            </a>
          </>
        )}
        {summary.state === "unavailable" && (
          <span className="flex h-8 items-center rounded-pac border border-line bg-panel px-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            Owner · unavailable
          </span>
        )}
      </div>
    </header>
  );
}
