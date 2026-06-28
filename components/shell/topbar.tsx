import { StatusBadge } from "@/components/ui/status-badge";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 backdrop-blur">
      <div>
        <p className="text-sm font-medium text-slate-100">
          Smart Algorithms Demo
        </p>
        <p className="text-xs text-slate-500">Workspace role: Owner</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden h-9 w-72 items-center rounded-lg border border-slate-800 bg-slate-900/70 px-3 text-sm text-slate-500 md:flex">
          Search or command placeholder
        </div>
        <StatusBadge tone="info">MVP Prototype</StatusBadge>
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-sm font-semibold text-slate-200">
          SA
        </div>
      </div>
    </header>
  );
}
