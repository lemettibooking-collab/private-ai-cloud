import type { OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";

type StatePanelProps = { title: string; body: string; children?: React.ReactNode; tone?: "neutral" | "accent" };

function StatePanel({ title, body, children, tone = "neutral" }: StatePanelProps) {
  return (
    <div className={`rounded-pac border bg-panel px-6 py-10 text-center ${tone === "accent" ? "border-accent/30" : "border-line"}`}>
      <p className="pac-label">{tone === "accent" ? "Authentication" : "Owner data"}</p>
      <p className="mt-2 text-base font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-5 text-ink-3">{body}</p>
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
      <a className="inline-flex h-8 items-center rounded-pac border border-accent/40 bg-accent/10 px-3 text-[13px] font-medium text-accent hover:bg-accent/20" href="/api/auth/signin">
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

export function ProjectContext({ project }: { project: OwnerConsoleProject }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-pac border border-line bg-panel px-2 py-1">
      <span className="pac-label">Project</span>
      <span className="text-xs font-medium text-ink">{project.displayName}</span>
      <span className="font-mono text-[11px] text-ink-3">{project.slug}</span>
    </span>
  );
}
