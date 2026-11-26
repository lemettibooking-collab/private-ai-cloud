import { WorkflowFilterPanel } from "@/components/domain/workflow-filter-panel";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

export default async function WorkflowsPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].workflows;
  const { workflowGroups, labels } = prototypeMock[locale];
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <WorkflowLifecycle />

      <div className="mt-6">
        <WorkflowFilterPanel
          groups={[...workflowGroups]}
          labels={{
            filters: c.filters,
            availability: labels.availability,
            approvalRequired: c.approvalRequired,
            reviewOptional: c.reviewOptional,
            locked: c.locked,
            runWorkflow: c.runWorkflow,
          }}
        />
      </div>
    </AppShell>
  );
}
