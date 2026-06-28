import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { WorkflowRunForm } from "@/components/domain/workflow-run-form";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { workflowPreviews } from "@/lib/workflow-config";

export default function TelegramContentRunPage() {
  return (
    <AppShell>
      <PageHeader
        description="Draft Telegram content with product context, risk check, approval requirement, and manual-only publish."
        eyebrow="Workflow run"
        title="Telegram Content"
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <WorkflowRunForm
          description="The generated post is static prototype output. Publishing is locked."
          fields={[
            { label: "Topic", placeholder: "Approval-first AI operations" },
            { label: "Angle", placeholder: "Founder/product education" },
            { label: "Format", placeholder: "Short Telegram post" },
            { label: "Target audience", placeholder: "Operators and owners" },
          ]}
          preview={workflowPreviews["telegram-content"]}
          title="Content brief"
        />
      </div>
    </AppShell>
  );
}
