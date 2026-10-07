import { CodexTaskArtifactForm } from "@/components/domain/codex-task-artifact-form";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypePages } from "@/lib/i18n/prototype-pages";

export default async function CodexTaskRunPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].codexForm;

  return (
    <AppShell>
      <PageHeader
        action={
          <div className="min-w-0 max-w-full [&_a]:h-auto [&_a]:min-h-9 [&_a]:whitespace-normal [&_a]:py-2 [&_a]:text-center">
            <ActionButton
              href="/workflows/development-plan/run"
              variant="secondary"
            >
              {c.openPlanSimulator}
            </ActionButton>
          </div>
        }
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />
      <WorkflowLifecycle compact />
      <div className="mt-6">
        <CodexTaskArtifactForm copy={c} />
      </div>
    </AppShell>
  );
}
