"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItems } from "@/lib/navigation";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 px-4 py-5">
      <Link className="block rounded-lg border border-slate-800 bg-slate-900/70 p-4" href="/dashboard">
        <p className="text-sm font-semibold text-slate-50">Private AI Cloud</p>
        <p className="mt-1 text-xs text-slate-500">AI Operations Center</p>
      </Link>

      <nav className="mt-6 flex flex-1 flex-col gap-1">
        {navigationItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              className={`rounded-lg border px-3 py-3 transition ${
                isActive
                  ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                  : "border-transparent text-slate-300 hover:border-slate-800 hover:bg-slate-900/70"
              }`}
              href={item.href}
              key={item.href}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {item.description}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          External actions
        </p>
        <p className="mt-2 text-sm text-slate-200">Locked by default</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Publish, send, run, and integration actions require approval.
        </p>
      </div>
    </aside>
  );
}
