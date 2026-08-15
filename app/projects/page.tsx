import { ProjectControlCenter } from "@/components/domain/project-control-center";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";

export default function ProjectsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Главные настройки проекта. Они определяют доступные ресурсы, модели, базу знаний, ограничения и правила для всех AI-отделов и процессов."
        eyebrow="Projects"
        title="Project Control Center"
      />
      <ProjectControlCenter />
    </AppShell>
  );
}
