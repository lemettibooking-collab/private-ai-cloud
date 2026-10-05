"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockIcon, navIcons } from "@/components/shell/icons";
import { ownerNavigation } from "@/lib/navigation";
import { projectScopedHref, type ProjectScopedPath } from "@/lib/projects/project-context";

type SidebarProps = {
  // Real, WORKSPACE-GLOBAL pending-approval count from the authenticated read path; null when unavailable.
  pendingApprovals: number | null;
  // The page's validated selected project (never parsed from the URL here); null = All Projects.
  selectedProjectId: string | null;
};

// Presentational group names for the existing navigation sections (labels and links are unchanged).
const sectionLabels: Readonly<Record<string, string>> = { overview: "Overview", work: "Work", platform: "Platform" };

// Project context is preserved on Dashboard / My Attention / Tasks / Runs / Approvals. Projects,
// Roadmap and Settings are not project-scoped and navigate without a selector.
export function Sidebar({ pendingApprovals, selectedProjectId }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="pac-shell sticky top-12 hidden h-[calc(100vh-3rem)] w-56 shrink-0 flex-col border-r border-line md:flex">
      <nav aria-label="Owner Console" className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-4">
        {ownerNavigation.map((section) => (
          <div key={section.id}>
            <p className="pac-label px-2.5 pb-1.5 !text-[9.5px] !text-ink-3/80">{sectionLabels[section.id] ?? section.id}</p>
            <ul className="space-y-px">
              {section.items.map((item) => {
                const Icon = navIcons[item.href];
                if (!item.available) {
                  return (
                    <li key={item.href}>
                      <div
                        aria-disabled="true"
                        className="flex h-8 cursor-default items-center gap-2.5 rounded-[7px] border border-transparent px-2.5 text-[13px] text-ink-3/55"
                        title="Not available yet"
                      >
                        {Icon && <Icon className="h-4 w-4 shrink-0" />}
                        <span className="flex-1">{item.label}</span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em]">soon</span>
                      </div>
                    </li>
                  );
                }
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const href = item.projectScoped ? projectScopedHref(item.href as ProjectScopedPath, selectedProjectId) : item.href;
                return (
                  <li key={item.href}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex h-8 items-center gap-2.5 rounded-[7px] border px-2.5 text-[13px] transition-colors ${
                        active ? "pac-nav-active font-medium text-ink" : "border-transparent text-ink-2 hover:border-line hover:bg-panel-2 hover:text-ink"
                      }`}
                      href={href}
                    >
                      {active && <span aria-hidden className="absolute inset-y-1.5 -left-2.5 w-[2px] rounded-r-full bg-accent" />}
                      {Icon && <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}`} />}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.attentionCount && pendingApprovals !== null && pendingApprovals > 0 && (
                        <span
                          className="rounded-[3px] border border-warn/30 bg-warn/10 px-1.5 font-mono text-[10.5px] leading-4 text-warn"
                          title="Pending approvals across all projects"
                        >
                          {pendingApprovals}
                          <span className="sr-only"> pending approvals</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="pac-inset mx-3 mb-3 px-3 py-2.5">
        <p className="pac-label !text-[9.5px]">Control plane</p>
        <dl className="mt-2 space-y-1.5 text-[11.5px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-3">External actions</dt>
            <dd className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2"><LockIcon className="h-3 w-3" />locked</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-3">Owner writes</dt>
            <dd className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">draft intent</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}
