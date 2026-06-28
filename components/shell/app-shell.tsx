import { DetailDrawer } from "@/components/shell/detail-drawer";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex">
        <Sidebar />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Topbar />
          <div className="flex flex-1">
            <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
            <DetailDrawer title="Context drawer">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-sm text-slate-300">
                  Select a document, approval, workflow run, or report to show
                  contextual details here.
                </p>
              </div>
            </DetailDrawer>
          </div>
        </div>
      </div>
    </div>
  );
}
