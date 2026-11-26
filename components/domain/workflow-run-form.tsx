import { ActionButton } from "@/components/ui/action-button";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkflowPreview } from "@/types/workflow";
import { SourceCitationCard } from "@/components/domain/source-citation-card";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

type WorkflowRunFormProps = {
  title: string;
  description: string;
  fields: Array<{
    label: string;
    placeholder: string;
    textarea?: boolean;
  }>;
  preview: WorkflowPreview;
};

export async function WorkflowRunForm({
  title,
  description,
  fields,
  preview,
}: WorkflowRunFormProps) {
  const { locale } = await getI18n();
  const c = prototypePages[locale].runForm;
  const { labels } = prototypeMock[locale];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <SectionCard title={title} description={description}>
        <div className="space-y-4">
          {fields.map((field) => (
            <label className="block" key={field.label}>
              <span className="text-sm font-medium text-slate-300">
                {field.label}
              </span>
              {field.textarea ? (
                <textarea
                  className="mt-2 min-h-28 w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400/40 placeholder:text-slate-600 focus:ring-2"
                  placeholder={field.placeholder}
                />
              ) : (
                <input
                  className="mt-2 h-10 w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 text-sm text-slate-100 outline-none ring-cyan-400/40 placeholder:text-slate-600 focus:ring-2"
                  placeholder={field.placeholder}
                />
              )}
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <ActionButton>{c.generate}</ActionButton>
            <ActionButton disabled variant="secondary">
              {c.sendToApproval}
            </ActionButton>
          </div>
          <p className="text-xs text-slate-500">
            {c.staticNote}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        action={<StatusBadge tone="warning">{c.approvalVisible}</StatusBadge>}
        title={preview.title}
        description={c.previewDescription}
      >
        <div className="space-y-4">
          {preview.sections.map((section) => (
            <div
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
              key={section.title}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  {section.title}
                </h3>
                {section.tone && (
                  <StatusBadge tone={section.tone}>{labels.tone[section.tone]}</StatusBadge>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {section.content}
              </p>
            </div>
          ))}
          {preview.sources && (
            <div className="space-y-3">
              {preview.sources.map((source) => (
                <SourceCitationCard citation={source} confidenceLabel={labels.confidence[source.confidence]} key={source.id} />
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
