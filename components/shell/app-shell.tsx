import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { loadOwnerAttentionSummary } from "@/lib/composition/owner-console-read.server";

type AppShellProps = {
  children: React.ReactNode;
  // Optional context drawer: rendered only when a page supplies real context.
  drawer?: React.ReactNode;
};

// Owner Console shell. The attention summary is loaded once per request through the authenticated
// Owner read path (no cross-request caching); the browser receives only counts and states.
export async function AppShell({ children, drawer }: AppShellProps) {
  const summary = await loadOwnerAttentionSummary();
  const pendingApprovals = summary.state === "available" ? summary.pendingApprovals : null;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <Topbar summary={summary} />
      <div className="flex min-h-0 flex-1">
        <Sidebar pendingApprovals={pendingApprovals} />
        <main className="min-w-0 flex-1 px-6 py-5 2xl:px-8">{children}</main>
        {drawer}
      </div>
    </div>
  );
}
