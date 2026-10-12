import { AmbientShaderBackground } from "@/components/shell/ambient-shader-background";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { loadOwnerShell, type OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";

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
// AI-038.5: the content column is width-controlled so 1440 / 1728 / 1920 px keep one rhythm, and
// sits above the decorative ambient layer (globals.css `.pac-ambient`). AI-038.7: that layer is a
// small prop-less client component — a WebGL ambient shader over the CSS fallback; no data reaches it.
export async function AppShell({ children, drawer, selectedProject = null }: AppShellProps) {
  const shell = await loadOwnerShell();
  const { locale, t } = await getI18n();
  const pendingApprovals = shell.state === "available" ? shell.pendingApprovals : null;
  const selectedProjectId = selectedProject?.projectId ?? null;

  return (
    <div className="relative isolate flex min-h-screen flex-col text-ink">
      {/* Ambient background: decorative only (WebGL shader over the CSS fallback), static under reduced motion. */}
      <AmbientShaderBackground />
      <Topbar locale={locale} selectedProject={selectedProject} shell={shell} t={t} />
      <div className="relative z-[1] flex min-h-0 flex-1">
        <Sidebar labels={t.nav} pendingApprovals={pendingApprovals} selectedProjectId={selectedProjectId} />
        <main className="min-w-0 flex-1 px-6 pb-10 pt-5 2xl:px-8">
          <div className="mx-auto w-full max-w-[1560px]">{children}</div>
        </main>
        {drawer}
      </div>
    </div>
  );
}
