import type { OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";

type ProjectSwitcherProps = {
  project: OwnerConsoleProject | null;
};

// Shows ONLY the project chosen by trusted server configuration. It never selects a workspace:
// there is no trusted Project Registry yet, so no other project is listed or selectable.
export function ProjectSwitcher({ project }: ProjectSwitcherProps) {
  return (
    <details className="group relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-pac border border-line bg-panel px-2.5 hover:border-line-strong">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${project ? "bg-ok" : "bg-idle"}`} />
        <span className="text-[13px] font-medium text-ink">{project ? project.displayName : "No project configured"}</span>
        <span aria-hidden className="text-[10px] text-ink-3 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 z-30 mt-1.5 w-80 rounded-pac border border-line-strong bg-panel-2 p-3 shadow-xl shadow-black/40">
        <p className="pac-label">Current project</p>
        {project ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-pac border border-line bg-panel px-2.5 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{project.displayName}</p>
              <p className="truncate font-mono text-[11px] text-ink-3">{project.slug}</p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ok">active</span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-3">The trusted workspace configuration is missing or invalid.</p>
        )}
        <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-4 text-ink-3">
          Additional projects will appear when the trusted Project Registry is connected.
        </p>
      </div>
    </details>
  );
}
