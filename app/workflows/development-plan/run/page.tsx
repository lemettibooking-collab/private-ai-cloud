import { DevelopmentPlanSimulator } from "@/components/domain/development-plan-simulator";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";

export default function DevelopmentPlanRunPage() {
  return (
    <AppShell>
      <PageHeader
        description="Учебная демонстрация будущего модуля. Ничего не сохраняется, не запускается и не отправляется во внешние системы."
        eyebrow="Знакомство с процессом"
        title="Симулятор плана разработки"
      />
      <DevelopmentPlanSimulator />
    </AppShell>
  );
}
