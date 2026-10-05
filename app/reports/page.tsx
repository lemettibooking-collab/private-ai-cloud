import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

export default async function ReportsPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].reports;
  const { reports, weeklyOwnerReportSummary, labels } = prototypeMock[locale];
  const roadmapItems = prototypeContent[locale].roadmap.items;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <SectionCard
        description={c.structureDescription}
        title={c.structureTitle}
      >
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {c.structure.map((section, index) => (
            <div
              className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
              key={section}
            >
              <StatusBadge tone={index === 1 ? "success" : "info"}>
                {section}
              </StatusBadge>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <SectionCard
          action={<StatusBadge tone="success">{c.currentMvp}</StatusBadge>}
          description={weeklyOwnerReportSummary.subtitle}
          title={weeklyOwnerReportSummary.title}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {weeklyOwnerReportSummary.metrics.map((metric) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                key={metric.label}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase text-slate-500">
                    {metric.label}
                  </p>
                  <StatusBadge tone={metric.tone}>{metric.value}</StatusBadge>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {weeklyOwnerReportSummary.sections.map((section) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                key={section.title}
              >
                <h3 className="text-sm font-semibold text-slate-100">
                  {section.title}
                </h3>
                <ul className="mt-3 space-y-2">
                  {section.items.map((item) => (
                    <li className="text-sm leading-6 text-slate-400" key={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          action={<StatusBadge tone="success">{c.currentBadge}</StatusBadge>}
          title={c.planningTitle}
        >
          <p className="text-sm leading-6 text-slate-300">
            {format(c.planningBody, { scope: roadmapItems[0].title })}
          </p>
          <div className="mt-4">
            <Link
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
              href="/roadmap"
            >
              {c.openRoadmap}
            </Link>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => (
          <SectionCard key={report.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  {report.owner}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-50">
                  {report.title}
                </h2>
              </div>
              <StatusBadge tone="info">{labels.reportStatus[report.status] ?? report.status}</StatusBadge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              {report.summary}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {report.metrics.map((metric) => (
                <StatusBadge key={metric} tone="neutral">
                  {metric}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
