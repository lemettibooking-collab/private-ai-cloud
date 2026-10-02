"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { projectScopedHref, switchTargetPath } from "@/lib/projects/project-context";

// Public project summary only (from the authenticated registry read). No auth, session or
// workspace data ever reaches this client component.
export type SwitcherProject = Readonly<{ projectId: string; displayName: string; status: "active" | "paused" | "archived" }>;

type ProjectSwitcherProps = {
  projects: readonly SwitcherProject[];
  selected: SwitcherProject | null;
  available: boolean;
  truncated: boolean;
};

function GlobeIcon() {
  return (
    <svg aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </svg>
  );
}

// Switches PROJECT context only: it stays on the same major Owner page and changes nothing but the
// `?project=` selector (absent = All Projects). The selection is not persisted anywhere.
export function ProjectSwitcher({ projects, selected, available, truncated }: ProjectSwitcherProps) {
  const pathname = usePathname();
  const target = switchTargetPath(pathname);
  const details = useRef<HTMLDetailsElement>(null);
  const close = () => details.current?.removeAttribute("open");

  return (
    <details className="group relative" ref={details}>
      <summary className={`flex h-8 cursor-pointer list-none items-center gap-2 rounded-pac border px-2.5 hover:border-line-strong ${
        selected ? "border-line bg-panel" : "border-accent/30 bg-accent/5"}`}>
        {selected ? (
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${selected.status === "active" ? "bg-ok" : "bg-warn"}`} />
        ) : (
          <span className="text-accent"><GlobeIcon /></span>
        )}
        <span className="text-[13px] font-medium text-ink">{selected ? selected.displayName : "All Projects"}</span>
        {selected && <span className="hidden font-mono text-[11px] text-ink-3 xl:inline">{selected.projectId}</span>}
        <span aria-hidden className="text-[10px] text-ink-3 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 z-30 mt-1.5 w-80 rounded-pac border border-line-strong bg-panel-2 p-1.5 shadow-xl shadow-black/40">
        <Link
          aria-current={selected ? undefined : "true"}
          className={`flex items-center gap-2.5 rounded-[5px] px-2.5 py-2 ${selected ? "hover:bg-raised" : "bg-accent/10"}`}
          href={projectScopedHref(target, null)}
          onClick={close}
        >
          <span className="text-accent"><GlobeIcon /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">All Projects</span>
            <span className="block text-[11px] text-ink-3">Workspace-wide view</span>
          </span>
          {!selected && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">current</span>}
        </Link>
        <div className="my-1.5 border-t border-line" />
        <p className="pac-label px-2.5 pb-1">Projects</p>
        {!available && <p className="px-2.5 py-2 text-xs text-ink-3">Project registry unavailable.</p>}
        {available && projects.length === 0 && <p className="px-2.5 py-2 text-xs text-ink-3">No projects registered.</p>}
        <ul className="max-h-80 overflow-y-auto">
          {projects.map((project) => {
            const current = selected?.projectId === project.projectId;
            return (
              <li key={project.projectId}>
                <Link
                  aria-current={current ? "true" : undefined}
                  className={`flex items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 ${current ? "bg-accent/10" : "hover:bg-raised"}`}
                  href={projectScopedHref(target, project.projectId)}
                  onClick={close}
                >
                  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${project.status === "active" ? "bg-ok" : "bg-warn"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{project.displayName}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">{project.projectId}</span>
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                    {current ? <span className="text-accent">current</span> : project.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {truncated && <p className="px-2.5 pt-1.5 text-[11px] text-ink-3">Showing the first 100 registered projects.</p>}
      </div>
    </details>
  );
}
