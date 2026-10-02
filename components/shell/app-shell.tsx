import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { loadOwnerShell, type OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";

type AppShellProps = {
  children: React.ReactNode;
  // Optional context drawer: rendered only when a page supplies real context.
  drawer?: React.ReactNode;
  // The project selected for THIS page, already validated by the page's own authenticated registry
  // read. Never parsed from the URL here.
  selectedProject?: OwnerConsoleProject | null;
};

// Owner Console shell. The shell summary (workspace-global approval counts + registry projects for
// the switcher) is loaded once per request through the authenticated read path, with no
// cross-request caching. The browser receives only counts, states and public project summaries.
export async function AppShell({ children, drawer, selectedProject = null }: AppShellProps) {
  const shell = await loadOwnerShell();
  const pendingApprovals = shell.state === "available" ? shell.pendingApprovals : null;
  const selectedProjectId = selectedProject?.projectId ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <Topbar selectedProject={selectedProject} shell={shell} />
      <div className="flex min-h-0 flex-1">
        <Sidebar pendingApprovals={pendingApprovals} selectedProjectId={selectedProjectId} />
        <main className="min-w-0 flex-1 px-6 py-5 2xl:px-8">{children}</main>
        {drawer}
      </div>
    </div>
  );
}
