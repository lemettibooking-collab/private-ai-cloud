import { DevelopmentPlanSimulator } from "@/components/domain/development-plan-simulator";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypePages } from "@/lib/i18n/prototype-pages";

// Bilingual (AI-038.6 L10N-2): copy from lib/i18n/prototype-pages (devPlan), passed to the simulator.
export default async function DevelopmentPlanRunPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].devPlan;
  return (
    <AppShell>
      <PageHeader
        action={
          <ActionButton href="/workflows/development-execution/run">
            {c.openExecution}
          </ActionButton>
        }
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />
      <DevelopmentPlanSimulator copy={c} />
    </AppShell>
  );
}
