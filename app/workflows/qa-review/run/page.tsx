import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { WorkflowRunForm } from "@/components/domain/workflow-run-form";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { workflowPreviews } from "@/lib/workflow-config";

export default function QaReviewRunPage() {
  return (
    <AppShell>
      <PageHeader
        description="Analyze diff/log context, list risks, note failed checks, and recommend approve, revise, or reject."
        eyebrow="Workflow run"
        title="QA / Review Report"
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <WorkflowRunForm
          description="The QA analysis is mocked. It demonstrates the target review report structure."
          fields={[
            {
              label: "Diff/log input",
              placeholder: "Paste changed files, lint output, build output, or review context",
              textarea: true,
            },
            {
              label: "Task context",
              placeholder: "What the implementation was supposed to achieve",
              textarea: true,
            },
          ]}
          preview={workflowPreviews["qa-review"]}
          title="Review input"
        />
      </div>
    </AppShell>
  );
}
