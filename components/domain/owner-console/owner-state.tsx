import Link from "next/link";
import type { OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";

type StatePanelProps = { title: string; body: string; children?: React.ReactNode; tone?: "neutral" | "accent" };

function StatePanel({ title, body, children, tone = "neutral" }: StatePanelProps) {
  return (
    <div className={`pac-surface px-6 py-9 text-center ${tone === "accent" ? "!border-accent/30" : ""}`}>
      <p className={`pac-label ${tone === "accent" ? "!text-accent" : ""}`}>{tone === "accent" ? "Authentication" : "Owner data"}</p>
      <p className="mt-2 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-5 text-ink-3">{body}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

export function SignInRequired() {
  return (
    <StatePanel
      body="The Owner Console shows private runtime data only to an authenticated PAC Owner. Sign in with the GitHub account linked to your PAC user."
      title="Sign-in required"
      tone="accent"
    >
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
      <a className="pac-control-accent inline-flex h-8 items-center px-3 text-[13px] font-medium" href="/api/auth/signin">
        Sign in
      </a>
    </StatePanel>
  );
}

// One generic state for every failure: no detail about the cause is shown.
export function OwnerDataUnavailable() {
  return (
    <StatePanel
      body="Owner data cannot be shown right now. This can mean the account is not authorized for this project or the runtime is temporarily unavailable."
      title="Owner data unavailable"
    />
  );
}

// Scope indicator: All Projects (global, workspace-wide) or one selected registry project.
export function ScopeBadge({ project }: { project: OwnerConsoleProject | null }) {
  if (!project) {
    return (
      <span className="pac-control inline-flex h-7 items-center gap-2 !border-accent/30 px-2.5">
        <span className="pac-label !text-[9.5px] !text-accent">Scope</span>
        <span className="text-xs font-medium text-ink">All Projects</span>
        <span className="font-mono text-[10.5px] text-ink-3">workspace-wide</span>
      </span>
    );
  }
  return (
    <span className="pac-control inline-flex h-7 items-center gap-2 px-2.5">
      <span className="pac-label !text-[9.5px]">Project</span>
      <span className="text-xs font-medium text-ink">{project.displayName}</span>
      <span className="font-mono text-[10.5px] text-ink-3">{project.projectId}</span>
      {project.status !== "active" && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-warn">{project.status}</span>}
    </span>
  );
}

// One opaque state for a malformed, duplicated, unknown, foreign or archived `?project=` selector.
// It deliberately does not fall back to All Projects and does not say why.
export function ProjectUnavailable({ allHref }: { allHref: string }) {
  return (
    <StatePanel
      body="This project is not available in the current workspace. The link may be outdated or not valid."
      title="Project unavailable"
    >
      <Link className="pac-control inline-flex h-8 items-center px-3 text-[13px] text-ink-2" href={allHref}>
        Open All Projects
      </Link>
    </StatePanel>
  );
}
