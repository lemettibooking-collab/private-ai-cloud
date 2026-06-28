import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { WorkflowRunForm } from "@/components/domain/workflow-run-form";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { workflowPreviews } from "@/lib/workflow-config";

export default function SupportReplyRunPage() {
  return (
    <AppShell>
      <PageHeader
        description="Generate a source-grounded support answer with classification, retrieved sources, safety note, and approval requirement."
        eyebrow="Workflow run"
        title="Support Reply"
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <WorkflowRunForm
          description="No real AI is called. Fill the mocked input fields to inspect the intended workflow shape."
          fields={[
            {
              label: "User question",
              placeholder: "How do I validate Scanner MVP locally?",
              textarea: true,
            },
            { label: "Channel", placeholder: "Website chat" },
            {
              label: "Optional user context",
              placeholder: "Plan, account state, previous support notes",
              textarea: true,
            },
          ]}
          preview={workflowPreviews["support-reply"]}
          title="Support request input"
        />
      </div>
    </AppShell>
  );
}
