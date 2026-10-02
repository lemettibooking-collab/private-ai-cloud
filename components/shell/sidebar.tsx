"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ownerNavigation } from "@/lib/navigation";
import { projectScopedHref, type ProjectScopedPath } from "@/lib/projects/project-context";

type SidebarProps = {
  // Real, WORKSPACE-GLOBAL pending-approval count from the authenticated read path; null when unavailable.
  pendingApprovals: number | null;
  // The page's validated selected project (never parsed from the URL here); null = All Projects.
  selectedProjectId: string | null;
};

// Project context is preserved on Dashboard / Runs / Approvals. Projects, Roadmap and Settings are
// not project-scoped yet and navigate without a selector.
export function Sidebar({ pendingApprovals, selectedProjectId }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-52 shrink-0 flex-col border-r border-line bg-canvas px-2.5 py-4 md:flex">
      <nav aria-label="Owner Console" className="flex flex-1 flex-col">
        {ownerNavigation.map((section, index) => (
          <div className={index > 0 ? "mt-3 border-t border-line pt-3" : ""} key={section.id}>
            {section.items.map((item) => {
              if (!item.available) {
                return (
                  <div
                    aria-disabled="true"
                    className="flex cursor-default items-center justify-between rounded-pac px-2.5 py-1.5 text-[13px] text-ink-3/60"
                    key={item.href}
                    title="Not available yet"
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3/60">soon</span>
                  </div>
                );
              }
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const href = item.projectScoped ? projectScopedHref(item.href as ProjectScopedPath, selectedProjectId) : item.href;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center justify-between rounded-pac px-2.5 py-1.5 text-[13px] transition ${
                    active ? "bg-panel-2 text-ink" : "text-ink-2 hover:bg-panel hover:text-ink"
                  }`}
                  href={href}
                  key={item.href}
                >
                  {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
                  <span>{item.label}</span>
                  {item.attentionCount && pendingApprovals !== null && pendingApprovals > 0 && (
                    <span className="rounded-[3px] bg-warn/15 px-1.5 font-mono text-[11px] text-warn" title="Pending approvals across all projects">{pendingApprovals}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-2.5 pt-3">
        <p className="pac-label">External actions</p>
        <p className="mt-1 text-xs text-ink-2">Locked by default</p>
        <p className="mt-0.5 text-[11px] leading-4 text-ink-3">Read-only console. Writes require a future approval boundary.</p>
      </div>
    </aside>
  );
}
