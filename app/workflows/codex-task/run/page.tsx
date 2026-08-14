import { CodexTaskArtifactForm } from "@/components/domain/codex-task-artifact-form";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";

export default function CodexTaskRunPage() {
  return (
    <AppShell>
      <PageHeader
        description="Подготовьте точное задание с контекстом, ограничениями, критериями приёмки и командами проверки."
        eyebrow="Запуск процесса"
        title="Задание для Codex"
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <CodexTaskArtifactForm />
      </div>
    </AppShell>
  );
}
