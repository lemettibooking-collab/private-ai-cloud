import Link from "next/link";
import type { OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";

type StatePanelProps = { title: string; body: string; label: string; children?: React.ReactNode; tone?: "neutral" | "accent" };

function StatePanel({ title, body, label, children, tone = "neutral" }: StatePanelProps) {
  return (
    <div className={`pac-surface px-6 py-9 text-center ${tone === "accent" ? "!border-accent/30" : ""}`}>
      <p className={`pac-label ${tone === "accent" ? "!text-accent" : ""}`}>{label}</p>
      <p className="mt-2 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-5 text-ink-3">{body}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

export async function SignInRequired() {
  const { t } = await getI18n();
  return (
    <StatePanel
      body={t.ownerState.signInBody}
      label={t.ownerState.authentication}
      title={t.ownerState.signInTitle}
      tone="accent"
    >
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing. */}
      <a className="pac-control-accent inline-flex h-8 items-center px-3 text-[13px] font-medium" href="/api/auth/signin">
        {t.ownerState.signIn}
      </a>
    </StatePanel>
  );
}

// One generic state for every failure: no detail about the cause is shown.
export async function OwnerDataUnavailable() {
  const { t } = await getI18n();
  return (
    <StatePanel
      body={t.ownerState.unavailableBody}
      label={t.ownerState.ownerData}
      title={t.ownerState.unavailableTitle}
    />
  );
}

// Scope indicator: All Projects (global, workspace-wide) or one selected registry project.
export async function ScopeBadge({ project }: { project: OwnerConsoleProject | null }) {
  const { t } = await getI18n();
  if (!project) {
    return (
      <span className="pac-control inline-flex h-7 items-center gap-2 !border-accent/30 px-2.5">
        <span className="pac-label !text-[9.5px] !text-accent">{t.common.scope}</span>
        <span className="text-xs font-medium text-ink">{t.common.allProjects}</span>
        <span className="text-[11px] text-ink-3">{t.common.workspaceWide}</span>
      </span>
    );
  }
  return (
    <span className="pac-control inline-flex h-7 items-center gap-2 px-2.5">
      <span className="pac-label !text-[9.5px]">{t.common.project}</span>
      <span className="text-xs font-medium text-ink">{project.displayName}</span>
      <span className="font-mono text-[10.5px] text-ink-3">{project.projectId}</span>
      {project.status !== "active" && <span className="text-[11px] text-warn">{t.projectStatus[project.status]}</span>}
    </span>
  );
}

// One opaque state for a malformed, duplicated, unknown, foreign or archived `?project=` selector.
// It deliberately does not fall back to All Projects and does not say why.
export async function ProjectUnavailable({ allHref }: { allHref: string }) {
  const { t } = await getI18n();
  return (
    <StatePanel
      body={t.ownerState.projectUnavailableBody}
      label={t.ownerState.ownerData}
      title={t.ownerState.projectUnavailableTitle}
    >
      <Link className="pac-control inline-flex h-8 items-center px-3 text-[13px] text-ink-2" href={allHref}>
        {t.ownerState.openAllProjects}
      </Link>
    </StatePanel>
  );
}
