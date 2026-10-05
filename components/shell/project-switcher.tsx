"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { ChevronIcon, GlobeIcon } from "@/components/shell/icons";
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

const statusDot: Record<SwitcherProject["status"], string> = { active: "bg-ok", paused: "bg-warn", archived: "bg-idle" };

// Switches PROJECT context only: it stays on the same major Owner page and changes nothing but the
// `?project=` selector (absent = All Projects). The selection is not persisted anywhere.
export function ProjectSwitcher({ projects, selected, available, truncated }: ProjectSwitcherProps) {
  const pathname = usePathname();
  const target = switchTargetPath(pathname);
  const details = useRef<HTMLDetailsElement>(null);
  const close = () => details.current?.removeAttribute("open");

  return (
    <details className="group relative" ref={details}>
      <summary
        aria-label={`Project context: ${selected ? selected.displayName : "All Projects"}. Change project`}
        className={`pac-control flex h-9 min-w-[15rem] cursor-pointer list-none items-center gap-2.5 px-2.5 group-open:!border-accent/45 ${
          selected ? "" : "!border-accent/30"}`}
      >
        {selected ? (
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${statusDot[selected.status]}`} />
        ) : (
          <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        )}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
            Project context{selected && selected.status !== "active" ? ` · ${selected.status}` : ""}
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-medium text-ink">{selected ? selected.displayName : "All Projects"}</span>
            <span className="hidden truncate font-mono text-[10.5px] text-ink-3 xl:inline">{selected ? selected.projectId : "workspace-wide"}</span>
          </span>
        </span>
        <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
      </summary>
      <div className="pac-popover absolute left-0 z-30 mt-2 w-[22rem] p-1.5">
        <Link
          aria-current={selected ? undefined : "true"}
          className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 ${selected ? "hover:bg-panel-2" : "pac-nav-active"}`}
          href={projectScopedHref(target, null)}
          onClick={close}
        >
          <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">All Projects</span>
            <span className="block text-[11px] text-ink-3">Workspace-wide view</span>
          </span>
          {!selected && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">current</span>}
        </Link>
        <div className="my-1.5 border-t border-line" />
        <p className="pac-label px-2.5 pb-1">Registered projects</p>
        {!available && <p className="px-2.5 py-2 text-xs text-ink-3">Project registry unavailable.</p>}
        {available && projects.length === 0 && <p className="px-2.5 py-2 text-xs text-ink-3">No projects registered.</p>}
        <ul className="max-h-80 overflow-y-auto">
          {projects.map((project) => {
            const current = selected?.projectId === project.projectId;
            return (
              <li key={project.projectId}>
                <Link
                  aria-current={current ? "true" : undefined}
                  className={`flex items-center gap-2.5 rounded-[7px] border border-transparent px-2.5 py-1.5 ${current ? "pac-nav-active" : "hover:bg-panel-2"}`}
                  href={projectScopedHref(target, project.projectId)}
                  onClick={close}
                >
                  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[project.status]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{project.displayName}</span>
                    <span className="block truncate font-mono text-[10.5px] text-ink-3">{project.projectId}</span>
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
