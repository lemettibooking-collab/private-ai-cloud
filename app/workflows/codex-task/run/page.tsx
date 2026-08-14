import { CodexTaskArtifactForm } from "@/components/domain/codex-task-artifact-form";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";

export default function CodexTaskRunPage() {
  return (
    <AppShell>
      <PageHeader
        action={
          <div className="min-w-0 max-w-full [&_a]:h-auto [&_a]:min-h-9 [&_a]:whitespace-normal [&_a]:py-2 [&_a]:text-center">
            <ActionButton
              href="/workflows/development-plan/run"
              variant="secondary"
            >
              Открыть симулятор плана разработки
            </ActionButton>
          </div>
        }
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
