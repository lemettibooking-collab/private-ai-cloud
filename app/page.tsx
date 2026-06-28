import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <section className="max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center shadow-2xl shadow-black/30">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
          MVP Prototype
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-50">
          Private AI Cloud
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-400">
          Static frontend prototype for a closed AI Operations Center:
          knowledge, chat, workflows, approvals, reports, and settings.
        </p>
        <div className="mt-8">
          <Link
            className="inline-flex h-11 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25"
            href="/dashboard"
          >
            Open dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
