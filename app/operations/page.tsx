import { ProjectOperationsCenter } from "@/components/domain/project-operations-center";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";

export default function OperationsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Owner-facing обзор параллельной работы проектов, очередей, отделов, агентов и workflows. Выбор проекта изменяет только отображение и не останавливает остальные проекты."
        eyebrow="Operations"
        title="Global Operations Center"
      />
      <ProjectOperationsCenter />
    </AppShell>
  );
}
