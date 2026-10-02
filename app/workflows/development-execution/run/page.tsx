import { DevelopmentExecutionSimulator } from "@/components/domain/development-execution-simulator";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";

export default function DevelopmentExecutionRunPage() {
  return (
    <AppShell>
      <PageHeader
        action={
          <ActionButton
            href="/workflows/development-plan/run"
            variant="secondary"
          >
            Вернуться к плану фичи
          </ActionButton>
        }
        description="Пошаговая frontend-only демонстрация разработки, проверок, review, исправлений и безопасной остановки по правилам AI-011."
        eyebrow="Учебный цикл разработки"
        title="Симулятор разработки и исправлений"
      />
      <DevelopmentExecutionSimulator />
    </AppShell>
  );
}
