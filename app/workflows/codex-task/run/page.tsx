import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { WorkflowRunForm } from "@/components/domain/workflow-run-form";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { workflowPreviews } from "@/lib/workflow-config";

export default function CodexTaskRunPage() {
  return (
    <AppShell>
      <PageHeader
        description="Transform product intent into a precise Codex task with context, constraints, acceptance criteria, and verify commands."
        eyebrow="Workflow run"
        title="Product / Codex Task"
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <WorkflowRunForm
          description="No Codex launch occurs in MVP. The output is copied/exported manually after approval."
          fields={[
            {
              label: "Product request",
              placeholder: "Create an approval detail prototype page",
              textarea: true,
            },
            {
              label: "Context",
              placeholder: "Use current UI shell and mocked approval data",
              textarea: true,
            },
            {
              label: "Constraints",
              placeholder: "No backend, no auth, no external integrations",
              textarea: true,
            },
          ]}
          preview={workflowPreviews["codex-task"]}
          title="Codex task input"
        />
      </div>
    </AppShell>
  );
}
