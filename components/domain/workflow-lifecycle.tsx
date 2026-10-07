import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

type WorkflowLifecycleProps = {
  compact?: boolean;
};

export async function WorkflowLifecycle({ compact = false }: WorkflowLifecycleProps) {
  const { locale } = await getI18n();
  const c = prototypePages[locale].workflows;
  const { workflowLifecycleSteps } = prototypeMock[locale];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            {c.lifecycleTitle}
          </h2>
          {!compact && (
            <p className="mt-1 text-sm leading-6 text-slate-400">
              {c.lifecycleBody}
            </p>
          )}
        </div>
        <StatusBadge tone="info">{c.mocked}</StatusBadge>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {workflowLifecycleSteps.map((step, index) => (
          <div
            className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
            key={step.status}
          >
            <p className="text-xs font-medium uppercase text-slate-500">
              {index + 1}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-100">
              {step.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
