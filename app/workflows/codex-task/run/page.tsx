import { CodexTaskArtifactForm } from "@/components/domain/codex-task-artifact-form";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";

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
        <CodexTaskArtifactForm />
      </div>
    </AppShell>
  );
}
