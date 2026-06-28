import { WorkflowFilterPanel } from "@/components/domain/workflow-filter-panel";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { workflowGroups } from "@/lib/mock-data";

export default function WorkflowsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Run repeatable AI operations with mocked data, visible approval gates, and no external execution."
        eyebrow="Workflows"
        title="Workflow catalog"
      />

      <WorkflowLifecycle />

      <div className="mt-6">
        <WorkflowFilterPanel groups={workflowGroups} />
      </div>
    </AppShell>
  );
}
