import { DevelopmentExecutionSimulator } from "@/components/domain/development-execution-simulator";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypePages } from "@/lib/i18n/prototype-pages";

export default async function DevelopmentExecutionRunPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].devExec;

  return (
    <AppShell>
      <PageHeader
        action={
          <ActionButton
            href="/workflows/development-plan/run"
            variant="secondary"
          >
            {c.backToPlan}
          </ActionButton>
        }
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />
      <DevelopmentExecutionSimulator copy={c} />
    </AppShell>
  );
}
